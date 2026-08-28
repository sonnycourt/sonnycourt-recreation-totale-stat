import { createHash, timingSafeEqual } from 'node:crypto';
import { supabaseGet } from './lib/supabase-rest.mjs';
import {
  normalizeMc2SupportEmail,
  summarizeMc2SupportDiagnostic,
} from './lib/mc2-support-diagnostic.mjs';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function hash(value) {
  return createHash('sha256').update(String(value || '')).digest();
}

function configuredAccessKeys(env = process.env) {
  const result = [];
  const raw = String(env.MC2_SUPPORT_API_KEYS || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [actor, token] of Object.entries(parsed)) {
          const safeActor = String(actor || '').trim().slice(0, 80);
          const safeToken = String(token || '').trim();
          if (safeActor && safeToken.length >= 32) result.push({ actor: safeActor, token: safeToken });
        }
      }
    } catch {
      return [];
    }
  }
  const fallback = String(env.MC2_SUPPORT_API_TOKEN || '').trim();
  if (fallback.length >= 32) result.push({ actor: 'support', token: fallback });
  return result;
}

export function authorizeMc2SupportRequest(req, env = process.env) {
  const match = String(req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  const supplied = String(match?.[1] || '').trim();
  if (!supplied) return null;
  const suppliedHash = hash(supplied);
  for (const entry of configuredAccessKeys(env)) {
    if (timingSafeEqual(suppliedHash, hash(entry.token))) return entry.actor;
  }
  return null;
}

async function readOptional(path, label, warnings) {
  try {
    const result = await supabaseGet(path);
    if (!result.ok) {
      warnings.push(`${label} indisponible`);
      return [];
    }
    return Array.isArray(result.data) ? result.data : [];
  } catch {
    warnings.push(`${label} indisponible`);
    return [];
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const actor = authorizeMc2SupportRequest(req);
  if (!actor) return json(401, { error: 'Accès support non autorisé.' });

  const body = await req.json().catch(() => ({}));
  const email = normalizeMc2SupportEmail(body?.email);
  if (!email) return json(400, { error: 'Adresse email invalide.' });

  try {
    const select = [
      'token', 'telephone', 'pays', 'slot_kind', 'visitor_timezone',
      'session_starts_at', 'session_ends_at', 'offer_expires_at', 'statut',
      'registration_completed_at', 'registered_at', 'session_page_view_count',
      'attended_live', 'session_joined_at', 'watch_max_seconds_live',
      'watch_max_seconds_replay', 'saw_offer', 'checkout_view_count',
      'checkout_engaged', 'checkout_last_plan', 'checkout_last_payment_mode',
      'checkout_last_viewed_at', 'payment_status', 'purchased_at',
    ].join(',');
    const registrationResult = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}&select=${select}&order=registered_at.desc&limit=1`,
    );
    if (!registrationResult.ok) return json(503, { error: 'Les données MC2 sont momentanément indisponibles.' });
    const registration = Array.isArray(registrationResult.data) ? registrationResult.data[0] || null : null;
    const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 12);
    if (!registration) {
      console.info('mc2-support-diagnostic', { actor, emailHash, found: false });
      return json(200, summarizeMc2SupportDiagnostic({ registration: null }));
    }

    const tokenFilter = encodeURIComponent(registration.token);
    const warnings = [];
    const [events, presenceRows, sessionEmails, smsJobs, replayJobs] = await Promise.all([
      readOptional(
        `mc2_funnel_events?token=eq.${tokenFilter}&select=event_name,event_value,occurred_at&order=occurred_at.asc&limit=300`,
        'Historique du funnel',
        warnings,
      ),
      readOptional(
        `mc2_presence?token=eq.${tokenFilter}&select=stage,current_second,is_playing,mode,updated_at&limit=1`,
        'Présence en direct',
        warnings,
      ),
      readOptional(
        `mc2_session_email_jobs?token=eq.${tokenFilter}&select=message_type,status,due_at,attempts,last_error,skip_reason,last_attempt_at,delivered_at&order=due_at.asc&limit=30`,
        'Emails de session',
        warnings,
      ),
      readOptional(
        `mc2_sms_jobs?token=eq.${tokenFilter}&select=message_type,status,due_at,attempts,last_error,skip_reason,last_attempt_at,sent_at&order=due_at.asc&limit=20`,
        'SMS',
        warnings,
      ),
      readOptional(
        `mc2_replay_recovery_jobs?token=eq.${tokenFilter}&select=segment,status,due_at,attempts,last_error,skip_reason,last_attempt_at,delivered_at&order=due_at.asc&limit=20`,
        'Emails de replay',
        warnings,
      ),
    ]);

    const payload = summarizeMc2SupportDiagnostic({
      registration,
      events,
      presence: presenceRows[0] || null,
      sessionEmails,
      smsJobs,
      replayJobs,
      warnings,
    });
    console.info('mc2-support-diagnostic', { actor, emailHash, found: true, status: payload.diagnosis.status });
    return json(200, payload);
  } catch (error) {
    console.error('mc2-support-diagnostic error:', error?.message || error);
    return json(500, { error: 'Erreur interne.' });
  }
};
