import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';

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

const RAISONS = new Set([
  'acheteur_es',
  'acheteur_manifest',
  'acheteur_ssr',
  'acheteur_neuro_ia',
  'acheteur_challenge',
  'manuel',
]);

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
    const raison = String(body?.raison || '').trim();

    if (!email || !email.includes('@')) {
      return jsonResponse(400, { error: 'Email invalide' });
    }
    if (!RAISONS.has(raison)) {
      return jsonResponse(400, { error: 'Raison invalide' });
    }

    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      return jsonResponse(500, { error: 'Supabase non configuré' });
    }

    const res = await fetch(`${url}/rest/v1/webinaire_exclusions?on_conflict=email`, {
      method: 'POST',
      headers: supabaseHeaders({
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify({ email, raison }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('add-webinaire-exclusion:', res.status, err);
      return jsonResponse(500, { error: 'Upsert impossible' });
    }

    return jsonResponse(200, { success: true, email, raison });
  } catch (error) {
    console.error('add-webinaire-exclusion error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
