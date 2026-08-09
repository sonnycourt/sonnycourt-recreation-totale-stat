import crypto from 'crypto';
import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';
import { validateMc2SessionSelection } from './lib/mc2-session.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function generateToken() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function trim(value, max = 255) {
  const cleaned = String(value || '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function registrationResponse(row, alreadyRegistered = false) {
  return {
    success: true,
    alreadyRegistered,
    token: row.token,
    statut: row.statut || 'partial',
    sessionStartsAt: row.session_starts_at,
    sessionEndsAt: row.session_ends_at,
    slotKind: row.slot_kind,
    visitorTimezone: row.visitor_timezone,
    redirectTo: `/mc2/confirmation?t=${encodeURIComponent(row.token)}`,
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
    const prenom = String(body?.prenom || '').trim().slice(0, 120);
    const telephone = trim(body?.telephone, 40);
    const pays = trim(body?.pays, 80);
    const isComplete = Boolean(telephone && pays);

    if (!email || !email.includes('@') || !prenom) {
      return jsonResponse(400, { error: 'Paramètres manquants' });
    }

    const selection = validateMc2SessionSelection({
      sessionStartsAt: body?.session_starts_at,
      slotKind: String(body?.slot_kind || '').trim().toLowerCase(),
      visitorTimezone: String(body?.visitor_timezone || '').trim(),
    });
    if (!selection.ok) return jsonResponse(400, { error: selection.error });

    const exclusions = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=email,raison&limit=1`,
    );
    if (exclusions.ok && Array.isArray(exclusions.data) && exclusions.data.length > 0) {
      return jsonResponse(403, { error: 'excluded', reason: 'excluded', raison: exclusions.data[0].raison });
    }

    const source = ['meta_ad', 'tiktok_ad', 'instagram_ad'].includes(String(body?.traffic_source || '').trim().toLowerCase())
      ? String(body.traffic_source).trim().toLowerCase()
      : null;
    const nowIso = new Date().toISOString();
    const sessionFields = {
      session_slot_id: trim(body?.creneau, 40) || selection.slotKind,
      slot_kind: selection.slotKind,
      visitor_timezone: selection.visitorTimezone,
      session_starts_at: selection.sessionStartsAt.toISOString(),
      session_ends_at: selection.sessionEndsAt.toISOString(),
    };

    const existing = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    );
    if (!existing.ok) {
      console.error('MC2 registration lookup failed:', existing.status, existing.error);
      return jsonResponse(500, { error: 'Erreur base de données MC2' });
    }

    if (Array.isArray(existing.data) && existing.data.length > 0) {
      const row = existing.data[0];
      const patch = {
        prenom,
        ...sessionFields,
        statut: isComplete ? 'registered' : (row.statut || 'partial'),
        telephone: telephone || row.telephone || null,
        pays: pays || row.pays || null,
        registration_completed_at: isComplete ? (row.registration_completed_at || nowIso) : row.registration_completed_at,
        traffic_source: source || row.traffic_source || null,
        utm_source: trim(body?.utm_source) || row.utm_source || null,
        utm_medium: trim(body?.utm_medium) || row.utm_medium || null,
        utm_campaign: trim(body?.utm_campaign) || row.utm_campaign || null,
        utm_content: trim(body?.utm_content) || row.utm_content || null,
        utm_term: trim(body?.utm_term) || row.utm_term || null,
        tt_click_id: trim(body?.tt_click_id) || row.tt_click_id || null,
        tt_event_id: trim(body?.tt_event_id) || row.tt_event_id || null,
        meta_fbc: trim(body?.meta_fbc) || row.meta_fbc || null,
        meta_fbp: trim(body?.meta_fbp) || row.meta_fbp || null,
        meta_event_id: trim(body?.meta_event_id) || row.meta_event_id || null,
        optin_variant: trim(body?.optin_variant, 80) || row.optin_variant || null,
        optin_funnel_id: trim(body?.optin_funnel_id, 80) || row.optin_funnel_id || null,
      };
      const updated = await supabasePatch(
        'mc2_registrations',
        `token=eq.${encodeURIComponent(row.token)}`,
        patch,
      );
      if (!updated.ok) {
        console.error('MC2 registration update failed:', updated.status, updated.error);
        return jsonResponse(500, { error: 'Erreur mise à jour MC2' });
      }
      return jsonResponse(200, registrationResponse({ ...row, ...patch }, true));
    }

    const row = {
      token: generateToken(),
      email,
      prenom,
      telephone,
      pays,
      ...sessionFields,
      statut: isComplete ? 'registered' : 'partial',
      registration_completed_at: isComplete ? nowIso : null,
      traffic_source: source,
      utm_source: trim(body?.utm_source),
      utm_medium: trim(body?.utm_medium),
      utm_campaign: trim(body?.utm_campaign),
      utm_content: trim(body?.utm_content),
      utm_term: trim(body?.utm_term),
      tt_click_id: trim(body?.tt_click_id),
      tt_event_id: trim(body?.tt_event_id),
      meta_fbc: trim(body?.meta_fbc),
      meta_fbp: trim(body?.meta_fbp),
      meta_event_id: trim(body?.meta_event_id),
      optin_variant: trim(body?.optin_variant, 80),
      optin_funnel_id: trim(body?.optin_funnel_id, 80),
    };
    const inserted = await supabasePost('mc2_registrations', row, { prefer: 'return=minimal' });
    if (!inserted.ok) {
      console.error('MC2 registration insert failed:', inserted.status, inserted.error);
      return jsonResponse(500, { error: 'Erreur enregistrement MC2' });
    }
    return jsonResponse(200, registrationResponse(row));
  } catch (error) {
    console.error('register-mc2 error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error?.message : undefined,
    });
  }
};
