import { resolveEs2FeedbackRegistration, isEs2FeedbackBuyer } from './lib/es2-feedback-access.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const url = new URL(req.url);
    const token = String(url.searchParams.get('t') || url.searchParams.get('token') || '').trim();
    const email = String(url.searchParams.get('email') || '')
      .trim()
      .toLowerCase();

    if (!token && !email) {
      return jsonResponse(400, { error: 'Token ou email requis' });
    }

    if (!token && (!email || !email.includes('@'))) return jsonResponse(400, { error: 'Email invalide' });
    const reg = await resolveEs2FeedbackRegistration({ token, email });
    if (!reg.ok) {
      console.error('get-es2-feedback-access query failed:', reg.status, reg.error);
      return jsonResponse(500, {
        error: 'Erreur serveur',
        details: process.env.NETLIFY_DEV ? reg.error : undefined,
      });
    }

    const row = Array.isArray(reg.data) ? reg.data[0] : null;
    if (!row) return jsonResponse(404, { found: false, error: 'not_found' });

    if (!isEs2FeedbackBuyer(row)) {
      return jsonResponse(403, {
        found: true,
        allowed: false,
        reason: 'not_purchased',
      });
    }

    return jsonResponse(200, {
      found: true,
      allowed: true,
      token: row.token,
      email: row.email || '',
      prenom: row.prenom || '',
    });
  } catch (error) {
    console.error('get-es2-feedback-access error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
