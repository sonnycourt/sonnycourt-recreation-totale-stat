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

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function resolveWhatsappGroupForSession(sessionDateIso) {
  const sessionDate = String(sessionDateIso || '').slice(0, 10);
  if (!sessionDate) return { whatsappLink: '', whatsappGroupNumber: null };

  try {
    const cfg = await supabaseGet(
      `webi_sessions_config?session_date=eq.${encodeURIComponent(sessionDate)}&select=*`,
    );
    if (!cfg.ok || !Array.isArray(cfg.data) || cfg.data.length === 0) {
      return { whatsappLink: '', whatsappGroupNumber: null };
    }

    const rows = cfg.data
      .map((row) => {
        const groupNumber = toFiniteNumber(row.group_number, NaN);
        const currentMembers = toFiniteNumber(row.current_members, NaN);
        const maxMembers = toFiniteNumber(row.max_members, NaN);
        const whatsappLink = String(
          row.whatsapp_link || row.group_link || row.link || '',
        ).trim();
        return { groupNumber, currentMembers, maxMembers, whatsappLink };
      })
      .filter((row) => Number.isFinite(row.groupNumber) && row.whatsappLink);

    if (!rows.length) return { whatsappLink: '', whatsappGroupNumber: null };

    const open = rows
      .filter((row) => Number.isFinite(row.currentMembers) && Number.isFinite(row.maxMembers) && row.currentMembers < row.maxMembers)
      .sort((a, b) => {
        if (a.currentMembers !== b.currentMembers) return a.currentMembers - b.currentMembers;
        return a.groupNumber - b.groupNumber;
      });

    const chosen = (open[0] || rows.sort((a, b) => a.groupNumber - b.groupNumber)[0]) || null;
    if (!chosen) return { whatsappLink: '', whatsappGroupNumber: null };
    return {
      whatsappLink: chosen.whatsappLink,
      whatsappGroupNumber: chosen.groupNumber,
    };
  } catch {
    return { whatsappLink: '', whatsappGroupNumber: null };
  }
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
    const token = (url.searchParams.get('t') || url.searchParams.get('token') || '').trim();

    if (!token) {
      return jsonResponse(400, { error: 'Token manquant' });
    }

    const res = await supabaseGet(
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=prenom,creneau,session_date,session_ends_at,offre_expires_at,statut,email,purchased,attended_live`,
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
    const whatsapp = await resolveWhatsappGroupForSession(row.session_date);

    return jsonResponse(200, {
      valid: true,
      prenom: row.prenom || '',
      creneau: row.creneau || '20h',
      statut: row.statut || 'inscrit',
      email: row.email || undefined,
      sessionStartsAt: row.session_date,
      sessionEndsAt: row.session_ends_at,
      offreExpiresAt: row.offre_expires_at,
      attended_live: row.attended_live === true,
      purchased,
      whatsappLink: whatsapp.whatsappLink || '',
      whatsappGroupNumber: Number.isFinite(whatsapp.whatsappGroupNumber) ? whatsapp.whatsappGroupNumber : null,
    });
  } catch (error) {
    console.error('get-webinaire-registration error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
