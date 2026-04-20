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

function toBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function isEs2Buyer(row) {
  return toBool(row?.es_purchased) || toBool(row?.purchased);
}

async function fetchRegistrationByFilter(filter) {
  const withEsPurchased = await supabaseGet(
    `webinaire_registrations?${filter}&select=token,email,prenom,es_purchased,purchased&limit=1`,
  );
  if (withEsPurchased.ok && Array.isArray(withEsPurchased.data)) {
    return withEsPurchased;
  }

  // Compatibility fallback if es_purchased column is absent.
  const fallback = await supabaseGet(
    `webinaire_registrations?${filter}&select=token,email,prenom,purchased&limit=1`,
  );
  if (fallback.ok && Array.isArray(fallback.data)) {
    const row = fallback.data[0];
    return {
      ...fallback,
      data: row ? [{ ...row, es_purchased: row.purchased }] : [],
    };
  }
  return withEsPurchased.ok ? fallback : withEsPurchased;
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

    let filter = '';
    if (token) {
      filter = `token=eq.${encodeURIComponent(token)}`;
    } else {
      if (!email || !email.includes('@')) {
        return jsonResponse(400, { error: 'Email invalide' });
      }
      filter = `email=eq.${encodeURIComponent(email)}`;
    }

    const reg = await fetchRegistrationByFilter(filter);
    if (!reg.ok) {
      console.error('get-es2-feedback-access query failed:', reg.status, reg.error);
      return jsonResponse(500, {
        error: 'Erreur serveur',
        details: process.env.NETLIFY_DEV ? reg.error : undefined,
      });
    }

    const row = Array.isArray(reg.data) ? reg.data[0] : null;
    if (!row) return jsonResponse(404, { found: false, error: 'not_found' });

    if (!isEs2Buyer(row)) {
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
