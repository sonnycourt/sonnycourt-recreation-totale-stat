import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import { sendTikTokEvent } from './lib/tiktok-capi.mjs';
import { sendMetaEvent } from './lib/meta-capi.mjs';

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

/**
 * Envoie la vente (CompletePayment) au CAPI TikTok, uniquement pour le trafic
 * TikTok. event_id déterministe (purchase-<token>) => dédoublonné si plusieurs
 * triggers (cette détection + un éventuel webhook Spiffy futur).
 * Valeur paramétrable via TIKTOK_PURCHASE_VALUE_EUR (défaut 388 = 1er paiement).
 */
async function fireTikTokPurchase(req, token, row) {
  if (!row || row.traffic_source !== 'tiktok_ad' || !row.tt_click_id) return;
  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    undefined;
  const ua = req.headers.get('user-agent') || undefined;
  const value = Number(process.env.TIKTOK_PURCHASE_VALUE_EUR) || 388;
  try {
    await sendTikTokEvent({
      eventName: 'CompletePayment',
      eventId: 'purchase-' + token,
      email: row.email,
      phone: row.telephone,
      ip,
      userAgent: ua,
      ttclid: row.tt_click_id,
      value,
      currency: 'EUR',
      contentName: 'Esprit Subconscient 2.0',
    });
  } catch (e) {
    console.error('TikTok CAPI CompletePayment:', e);
  }
}

/**
 * Idem côté Meta : envoie la vente (Purchase) au CAPI Meta, uniquement pour le
 * trafic Meta. event_id déterministe (purchase-<token>) => dédoublonné.
 * Valeur paramétrable via META_PURCHASE_VALUE_EUR (défaut 388 = 1er paiement).
 */
async function fireMetaPurchase(req, token, row) {
  if (!row || row.traffic_source !== 'meta_ad') return;
  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    undefined;
  const ua = req.headers.get('user-agent') || undefined;
  const value = Number(process.env.META_PURCHASE_VALUE_EUR) || 388;
  try {
    await sendMetaEvent({
      eventName: 'Purchase',
      eventId: 'purchase-' + token,
      email: row.email,
      phone: row.telephone,
      ip,
      userAgent: ua,
      fbc: row.meta_fbc,
      fbp: row.meta_fbp,
      value,
      currency: 'EUR',
      contentName: 'Esprit Subconscient 2.0',
    });
  } catch (e) {
    console.error('Meta CAPI Purchase:', e);
  }
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchSessionWhatsappConfigRows(sessionDateIso) {
  const sessionDate = String(sessionDateIso || '').slice(0, 10);
  if (!sessionDate) return [];

  try {
    const cfg = await supabaseGet(
      `webi_sessions_config?session_date=eq.${encodeURIComponent(sessionDate)}&select=*`,
    );
    if (!cfg.ok || !Array.isArray(cfg.data) || cfg.data.length === 0) return [];

    return cfg.data
      .map((row) => {
        const groupNumber = toFiniteNumber(row.group_number, NaN);
        const currentMembers = Math.max(0, toFiniteNumber(row.current_members, 0));
        const maxMembers = toFiniteNumber(row.max_members, NaN);
        const whatsappLink = String(
          row.whatsapp_link || row.group_link || row.link || '',
        ).trim();
        return { groupNumber, currentMembers, maxMembers, whatsappLink };
      })
      .filter((row) => Number.isFinite(row.groupNumber) && row.whatsappLink);
  } catch {
    return [];
  }
}

async function resolveWhatsappGroupForAssignedRow(row) {
  const assignedGroup = toFiniteNumber(row?.whatsapp_group_number, NaN);
  const assignedLink = String(row?.whatsapp_link || '').trim();
  if (Number.isFinite(assignedGroup) && assignedGroup > 0 && assignedLink) {
    return { whatsappLink: assignedLink, whatsappGroupNumber: assignedGroup };
  }

  if (!Number.isFinite(assignedGroup) || assignedGroup <= 0) {
    return { whatsappLink: '', whatsappGroupNumber: null };
  }

  // Backfill in case old rows have group number but missing link.
  const rows = await fetchSessionWhatsappConfigRows(row?.session_date);
  const match = rows.find((r) => r.groupNumber === assignedGroup) || null;
  return {
    whatsappLink: match?.whatsappLink || '',
    whatsappGroupNumber: assignedGroup,
  };
}

async function resolveAndAssignWhatsappGroup(token, registrationRow) {
  const alreadyAssigned = await resolveWhatsappGroupForAssignedRow(registrationRow);
  if (alreadyAssigned.whatsappLink && Number.isFinite(alreadyAssigned.whatsappGroupNumber)) {
    return alreadyAssigned;
  }

  const sessionDate = String(registrationRow?.session_date || '').slice(0, 10);
  if (!sessionDate) return { whatsappLink: '', whatsappGroupNumber: null };

  // Optimistic lock loop for concurrent assignments.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rows = await fetchSessionWhatsappConfigRows(registrationRow?.session_date);
    if (!rows.length) return { whatsappLink: '', whatsappGroupNumber: null };

    const open = rows
      .filter((row) => Number.isFinite(row.maxMembers) && row.currentMembers < row.maxMembers)
      .sort((a, b) => a.groupNumber - b.groupNumber);
    if (!open.length) return { whatsappLink: '', whatsappGroupNumber: null };

    let reserved = null;
    for (const candidate of open) {
      const expected = Math.max(0, toFiniteNumber(candidate.currentMembers, 0));
      const reserve = await supabasePatch(
        'webi_sessions_config',
        `session_date=eq.${encodeURIComponent(sessionDate)}&group_number=eq.${candidate.groupNumber}&current_members=eq.${expected}`,
        { current_members: expected + 1 },
      );
      if (reserve.ok && Array.isArray(reserve.data) && reserve.data.length > 0) {
        reserved = candidate;
        break;
      }
    }
    if (!reserved) continue;

    const saveAssigned = await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(token)}`,
      {
        whatsapp_group_number: reserved.groupNumber,
        whatsapp_link: reserved.whatsappLink,
      },
    );
    if (saveAssigned.ok) {
      return {
        whatsappLink: reserved.whatsappLink,
        whatsappGroupNumber: reserved.groupNumber,
      };
    }

    // If save fails, loop/retry to avoid hard-fail on transient issues.
  }

  return { whatsappLink: '', whatsappGroupNumber: null };
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
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=prenom,pays,creneau,session_date,session_ends_at,offre_expires_at,statut,email,telephone,purchased,attended_live,traffic_source,tt_click_id,meta_fbc,meta_fbp,whatsapp_group_number,whatsapp_link,created_at`,
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
      if (purchased) {
        syncPurchasedFlag(token);
        // 1re détection de la vente => event TikTok (trafic TikTok uniquement).
        await fireTikTokPurchase(req, token, row);
        // Idem côté Meta (trafic Meta uniquement).
        await fireMetaPurchase(req, token, row);
      }
    }
    const whatsapp = await resolveAndAssignWhatsappGroup(token, row);

    return jsonResponse(200, {
      valid: true,
      prenom: row.prenom || '',
      pays: row.pays || '',
      creneau: row.creneau || '20h',
      statut: row.statut || 'inscrit',
      email: row.email || undefined,
      sessionStartsAt: row.session_date,
      sessionEndsAt: row.session_ends_at,
      registeredAt: row.created_at,
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
