import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';
const MAILERLITE_TIMEOUT_MS = 3000;

function getAcheteursGroupId() {
  return (
    process.env.MAILERLITE_GROUP_WEBINAIRE_ACHETEURS ||
    process.env.MAILERLITE_GROUP_WEBINAIRE_ES2_ACHETEURS ||
    ''
  ).trim();
}

async function isInMailerLiteAcheteursGroup(email) {
  const apiKey = String(process.env.MAILERLITE_API_KEY || '').trim();
  const acheteursGroupId = getAcheteursGroupId();
  if (!apiKey || !acheteursGroupId || !email) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAILERLITE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${MAILERLITE_API_BASE}/subscribers/${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      },
    );
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    const groups = Array.isArray(body?.data?.groups) ? body.data.groups : [];
    return groups.some((g) => String(g?.id || '') === acheteursGroupId);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function syncPurchasedFlag(token) {
  if (!token) return;
  void supabasePatch(
    'webinaire_registrations',
    `token=eq.${encodeURIComponent(token)}`,
    { purchased: true },
  ).catch(() => {});
}

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
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=prenom,creneau,session_date,session_ends_at,offre_expires_at,statut,email,purchased`,
    );

    if (!res.ok) {
      return jsonResponse(500, { error: 'Erreur base de données' });
    }

    if (!Array.isArray(res.data) || res.data.length === 0) {
      return jsonResponse(404, { error: 'Token invalide' });
    }

    const row = res.data[0];
    let purchased = row.purchased === true;
    if (!purchased) {
      purchased = await isInMailerLiteAcheteursGroup(String(row.email || '').trim().toLowerCase());
      if (purchased) syncPurchasedFlag(token);
    }

    return jsonResponse(200, {
      valid: true,
      prenom: row.prenom || '',
      creneau: row.creneau || '20h',
      statut: row.statut || 'inscrit',
      email: row.email || undefined,
      sessionStartsAt: row.session_date,
      sessionEndsAt: row.session_ends_at,
      offreExpiresAt: row.offre_expires_at,
      purchased,
    });
  } catch (error) {
    console.error('get-webinaire-registration error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
