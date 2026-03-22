import { supabaseGet } from './lib/supabase-rest.mjs';

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

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = await req.json();
    const email = String(body?.email || '')
      .trim()
      .toLowerCase();

    if (!email || !email.includes('@')) {
      return jsonResponse(400, { error: 'Email invalide' });
    }

    const ex = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=raison`,
    );
    if (ex.ok && Array.isArray(ex.data) && ex.data.length > 0) {
      return jsonResponse(200, {
        eligible: false,
        reason: 'excluded',
        exclusion_raison: ex.data[0].raison || null,
      });
    }

    const reg = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,statut,session_date,session_ends_at,offre_expires_at`,
    );
    if (reg.ok && Array.isArray(reg.data) && reg.data.length > 0) {
      const r = reg.data[0];
      return jsonResponse(200, {
        eligible: false,
        reason: 'already_registered',
        token: r.token,
        statut: r.statut,
        session_date: r.session_date,
        session_ends_at: r.session_ends_at,
        offre_expires_at: r.offre_expires_at,
      });
    }

    return jsonResponse(200, { eligible: true });
  } catch (error) {
    console.error('check-webinaire-eligibility error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
