import { supabaseGet } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get('t') || '').trim();

    if (!token) {
      return jsonResponse(400, { error: 'Token manquant' });
    }

    const res = await supabaseGet(
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=prenom,creneau,session_date,session_ends_at,offre_expires_at,statut,email`,
    );

    if (!res.ok) {
      return jsonResponse(500, { error: 'Erreur base de données' });
    }

    if (!Array.isArray(res.data) || res.data.length === 0) {
      return jsonResponse(404, { error: 'Token invalide' });
    }

    const row = res.data[0];

    return jsonResponse(200, {
      valid: true,
      prenom: row.prenom || '',
      creneau: row.creneau || '20h',
      statut: row.statut || 'inscrit',
      email: row.email || undefined,
      sessionStartsAt: row.session_date,
      sessionEndsAt: row.session_ends_at,
      offreExpiresAt: row.offre_expires_at,
    });
  } catch (error) {
    console.error('get-webinaire-registration error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
