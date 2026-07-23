import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { sendTikTokEvent } from './lib/tiktok-capi.mjs';
import { sendMetaEvent } from './lib/meta-capi.mjs';

const ALLOWED_EVENTS = new Set([
  'session_joined',
  'video_checkpoint',
  'cta_reached',
  'cta_clicked',
  'checkout_clicked',
  'auto_redirect_to_offer',
  'invitation_visited',
  'replay_started',
  'video_freeze_recovery',
]);

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function buildPatch(eventName, currentRow, rawValue) {
  const patch = {
    last_event_at: new Date().toISOString(),
  };
  if (eventName === 'session_joined') {
    patch.attended_live = true;
    return patch;
  }
  if (eventName === 'video_checkpoint') {
    const cur = toPositiveInt(currentRow?.watch_max_minutes);
    const next = toPositiveInt(rawValue);
    patch.watch_max_minutes = Math.max(cur, next);
    return patch;
  }
  if (eventName === 'cta_reached') {
    patch.saw_offer = true;
    return patch;
  }
  if (eventName === 'cta_clicked') {
    patch.clicked_cta = true;
    return patch;
  }
  if (eventName === 'checkout_clicked') {
    patch.checkout_clicked = true;
    return patch;
  }
  if (eventName === 'invitation_visited') {
    patch.visited_sales = true;
    return patch;
  }
  if (eventName === 'replay_started') {
    patch.watched_replay = true;
    return patch;
  }
  return patch;
}

function buildMailerLiteFields(eventName, patch) {
  const fields = {};
  if (eventName === 'session_joined' && patch.attended_live) fields.es_attended_live = 'true';
  if (eventName === 'video_checkpoint' && Number.isFinite(patch.watch_max_minutes)) {
    fields.es_watch_max = String(patch.watch_max_minutes);
  }
  if (eventName === 'cta_reached' && patch.saw_offer) fields.es_saw_offer = 'true';
  if (eventName === 'cta_clicked' && patch.clicked_cta) fields.es_clicked_cta = 'true';
  if (eventName === 'replay_started' && patch.watched_replay) fields.es_watched_replay = 'true';
  return fields;
}

/**
 * Best-effort logging des freeze events dans la table dédiée webinaire_freeze_events.
 * Wrapped en try/catch global : aucune erreur d'INSERT ne doit bloquer la réponse
 * au client ni interrompre le flow existant (patch + mailerlite).
 *
 * Payload attendu côté client (JSON encodé dans `value`) :
 *   { trigger, currentTime_at_freeze, freeze_duration_sec,
 *     recovery_attempt_number, recovered, context }
 */
async function logFreezeEvent(token, email, sessionDate, rawValue) {
  try {
    if (!token) return;
    let parsed = null;
    if (typeof rawValue === 'string') {
      try { parsed = JSON.parse(rawValue); } catch { parsed = null; }
    } else if (rawValue && typeof rawValue === 'object') {
      parsed = rawValue;
    }
    if (!parsed || typeof parsed !== 'object') return;

    const sessionDateOnly = sessionDate ? String(sessionDate).slice(0, 10) : null;
    const insertBody = {
      token,
      email: email || null,
      session_date: sessionDateOnly,
      trigger: parsed.trigger ? String(parsed.trigger).slice(0, 64) : null,
      current_time_at_freeze: Number.isFinite(Number(parsed.currentTime_at_freeze))
        ? Number(parsed.currentTime_at_freeze)
        : null,
      freeze_duration_sec: Number.isFinite(Number(parsed.freeze_duration_sec))
        ? Number(parsed.freeze_duration_sec)
        : null,
      recovery_attempt_number: Number.isFinite(Number(parsed.recovery_attempt_number))
        ? Math.max(0, Math.floor(Number(parsed.recovery_attempt_number)))
        : null,
      recovered: typeof parsed.recovered === 'boolean' ? parsed.recovered : null,
      context: parsed.context ? String(parsed.context).slice(0, 32) : null,
    };

    const res = await supabasePost('webinaire_freeze_events', insertBody, { prefer: 'return=minimal' });
    if (!res.ok) {
      console.error('track-webinaire-event freeze log failed:', res.status, res.error);
    }
  } catch (err) {
    console.error('track-webinaire-event freeze log error:', err);
  }
}

async function mirrorToMailerLite(email, eventName, patch) {
  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey || !email) return;
  const fields = buildMailerLiteFields(eventName, patch);
  if (!Object.keys(fields).length) return;
  try {
    const res = await fetch(
      `https://connect.mailerlite.com/api/subscribers/${encodeURIComponent(email)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, fields }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('track-webinaire-event MailerLite update failed:', res.status, body);
    }
  } catch (err) {
    console.error('track-webinaire-event MailerLite error:', err);
  }
}

/**
 * Events mid-funnel vers TikTok (CAPI), uniquement pour le trafic TikTok.
 * - AttendedLive : à la 1re connexion live (présence = vrai humain)
 * - QualifiedView : au franchissement de 81 min de visionnage (seuil acheteur :
 *   100% des acheteurs ont regardé 81+ min)
 * event_id déterministe par token => TikTok dédoublonne (1 seul comptage).
 */
async function maybeFireTikTokFunnelEvent(req, eventName, row, patch) {
  if (!row || row.traffic_source !== 'tiktok_ad' || !row.tt_click_id) return;

  let ttEvent = null;
  let eventId = null;
  if (eventName === 'session_joined' && !row.attended_live) {
    ttEvent = 'AttendedLive';
    eventId = 'attendedlive-' + row.token;
  } else if (eventName === 'video_checkpoint') {
    const prev = toPositiveInt(row.watch_max_minutes);
    const next = toPositiveInt(patch.watch_max_minutes);
    if (prev < 81 && next >= 81) {
      ttEvent = 'QualifiedView';
      eventId = 'qualview-' + row.token;
    }
  }
  if (!ttEvent) return;

  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    undefined;
  const ua = req.headers.get('user-agent') || undefined;

  try {
    await sendTikTokEvent({
      eventName: ttEvent,
      eventId,
      email: row.email,
      phone: row.telephone,
      ip,
      userAgent: ua,
      ttclid: row.tt_click_id,
      url: 'https://sonnycourt.com/tt/masterclass',
      contentName: 'Masterclass ES2',
    });
  } catch (e) {
    console.error('TikTok funnel event:', e);
  }
}

/**
 * Idem mid-funnel côté Meta (CAPI), uniquement pour le trafic Meta.
 * Events custom AttendedLive / QualifiedView. event_id déterministe par token.
 */
async function maybeFireMetaFunnelEvent(req, eventName, row, patch) {
  if (!row || row.traffic_source !== 'meta_ad') return;

  let metaEvent = null;
  let eventId = null;
  if (eventName === 'session_joined' && !row.attended_live) {
    metaEvent = 'AttendedLive';
    eventId = 'attendedlive-' + row.token;
  } else if (eventName === 'video_checkpoint') {
    const prev = toPositiveInt(row.watch_max_minutes);
    const next = toPositiveInt(patch.watch_max_minutes);
    if (prev < 81 && next >= 81) {
      metaEvent = 'QualifiedView';
      eventId = 'qualview-' + row.token;
    }
  }
  if (!metaEvent) return;

  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    undefined;
  const ua = req.headers.get('user-agent') || undefined;

  try {
    await sendMetaEvent({
      eventName: metaEvent,
      eventId,
      email: row.email,
      phone: row.telephone,
      ip,
      userAgent: ua,
      fbc: row.meta_fbc,
      fbp: row.meta_fbp,
      url: 'https://sonnycourt.com/meta/masterclass',
      contentName: 'Masterclass ES2',
    });
  } catch (e) {
    console.error('Meta funnel event:', e);
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || '').trim();
    const eventName = String(body?.event || '').trim();
    const value = body?.value;

    if (!token) return jsonResponse(400, { error: 'Token manquant' });
    if (!ALLOWED_EVENTS.has(eventName)) return jsonResponse(400, { error: 'Event invalide' });

    const regRes = await supabaseGet(
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=token,email,telephone,watch_max_minutes,session_date,traffic_source,tt_click_id,meta_fbc,meta_fbp,attended_live&limit=1`,
    );
    if (!regRes.ok) return jsonResponse(500, { error: 'Erreur lecture base' });
    if (!Array.isArray(regRes.data) || regRes.data.length === 0) {
      return jsonResponse(404, { error: 'Token inconnu' });
    }

    const row = regRes.data[0];
    const patch = buildPatch(eventName, row, value);
    const upd = await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(token)}`,
      patch,
    );
    if (!upd.ok) {
      console.error('track-webinaire-event Supabase patch failed:', upd.status, upd.error);
      return jsonResponse(500, { error: 'Erreur écriture base' });
    }

    // Event mid-funnel TikTok (présence live / visionnage 81+ min). Awaité.
    await maybeFireTikTokFunnelEvent(req, eventName, row, patch);
    // Idem côté Meta.
    await maybeFireMetaFunnelEvent(req, eventName, row, patch);

    // Best-effort mirror to MailerLite. Never block client response.
    void mirrorToMailerLite(row.email || '', eventName, patch);

    // Clic checkout → groupe MailerLite CHECKOUT-ABANDON (l'automation de Ludovic
    // filtre les vrais abandons via délai + condition « pas acheteur »).
    if (eventName === 'checkout_clicked') {
      void addToCheckoutAbandonGroup(row.email || '', process.env.MAILERLITE_API_KEY);
    }

    // Best-effort logging des freeze events (table dédiée). Toute erreur est swallowed,
    // n'impacte pas la réponse au client ni les autres branches du tracking.
    if (eventName === 'video_freeze_recovery') {
      void logFreezeEvent(row.token || token, row.email || '', row.session_date || null, value);
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('track-webinaire-event error:', error);
    return jsonResponse(500, { error: 'Erreur serveur' });
  }
};
