import { supabaseGet } from './lib/supabase-rest.mjs';
import { mc2SessionEndsAtIso } from '../../src/lib/mc2-timing.mjs';
import {
  isMc2ReactivatedNoShow,
  isWebinarBuyerStatus,
  isWebinarRegistrationExclusion,
} from './lib/webinaire-exclusions.mjs';

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

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
    if (!email || !email.includes('@')) return jsonResponse(400, { error: 'Email invalide' });

    const exclusions = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=email,raison&limit=1`,
    );
    const exclusion = exclusions.ok && Array.isArray(exclusions.data)
      ? exclusions.data[0] || null
      : null;

    const existing = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}`
        + '&select=token,statut,payment_status,purchased_at,registration_completed_at,session_starts_at,session_ends_at,offer_expires_at&limit=1',
    );
    if (!existing.ok) return jsonResponse(500, { error: 'Erreur base de données MC2' });

    const row = Array.isArray(existing.data) ? existing.data[0] : null;
    const reactivatedNoShow = isMc2ReactivatedNoShow(exclusion?.raison);
    if (row && isWebinarBuyerStatus(row)) {
      return jsonResponse(200, { eligible: false, reason: 'excluded' });
    }
    if (exclusion && !reactivatedNoShow && !isWebinarRegistrationExclusion(exclusion.raison)) {
      return jsonResponse(200, { eligible: false, reason: 'excluded' });
    }
    const completed = Boolean(row?.registration_completed_at)
      || ['registered', 'present'].includes(String(row?.statut || '').toLowerCase());
    if (row && completed) {
      return jsonResponse(200, {
        eligible: false,
        reason: 'already_registered',
        token: row.token,
        statut: row.statut,
        session_date: row.session_starts_at,
        session_ends_at: mc2SessionEndsAtIso(row.session_starts_at),
        offre_expires_at: row.offer_expires_at,
      });
    }

    const legacy = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,statut&limit=1`,
    );
    if (!legacy.ok) return jsonResponse(500, { error: 'Erreur base de données webinaire' });
    if (Array.isArray(legacy.data) && legacy.data.length > 0 && !reactivatedNoShow) {
      return jsonResponse(200, { eligible: false, reason: 'excluded' });
    }

    if (exclusion && !reactivatedNoShow) {
      return jsonResponse(200, { eligible: false, reason: 'excluded' });
    }

    return jsonResponse(200, { eligible: true });
  } catch (error) {
    console.error('check-mc2-eligibility error:', error);
    return jsonResponse(500, { error: 'Erreur serveur' });
  }
};
