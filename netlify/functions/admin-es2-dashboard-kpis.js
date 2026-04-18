import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';

/** Liste « pays riches » — matching insensible à la casse et aux accents (colonne pays). */
const PAYS_RICHES = ['France', 'Belgique', 'Suisse', 'Canada', 'Luxembourg', 'Monaco', 'Allemagne'];

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function toBool(value) {
  return value === true;
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeCountryLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PAYS_RICHES_NORM = PAYS_RICHES.map((p) => normalizeCountryLabel(p));

function isRichCountry(pays) {
  const raw = String(pays || '').trim();
  if (!raw) return false;
  const n = normalizeCountryLabel(raw);
  return PAYS_RICHES_NORM.some((r) => {
    if (n === r) return true;
    if (n.startsWith(`${r} `)) return true;
    if (n.startsWith(`${r}(`)) return true;
    if (n.startsWith(`${r},`)) return true;
    return false;
  });
}

function computeSegmentStats(subset, buyerEmailSet) {
  const inscrits = subset.length;
  const presents = subset.filter((r) => toBool(r.attended_live)).length;
  const sawOffer = subset.filter((r) => toBool(r.saw_offer)).length;
  const clickedCta = subset.filter((r) => toBool(r.clicked_cta)).length;
  const acheteurs = subset.filter((r) => buyerEmailSet.has(normalizeEmail(r.email))).length;
  const presenceRate = inscrits > 0 ? (presents / inscrits) * 100 : 0;
  return {
    inscrits,
    presents,
    presenceRate,
    sawOffer,
    clickedCta,
    acheteurs,
  };
}

/**
 * Tous les emails du groupe acheteurs MailerLite (pagination curseur).
 * @returns {{ emails: Set<string>, error: string | null, pages: number }}
 */
async function fetchMailerLiteBuyerEmails(apiKey, groupId) {
  const emails = new Set();
  if (!apiKey || !groupId) {
    return { emails, error: !apiKey ? 'missing_api_key' : 'missing_group_id', pages: 0 };
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  let cursor = '';
  let pages = 0;
  const maxPages = 500;
  while (pages < maxPages) {
    const qs = new URLSearchParams({ limit: '1000' });
    if (cursor) qs.set('cursor', cursor);
    const url = `${MAILERLITE_API_BASE}/groups/${encodeURIComponent(groupId)}/subscribers?${qs.toString()}`;
    const res = await fetch(url, { method: 'GET', headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        emails,
        error: json?.message || `mailerlite_http_${res.status}`,
        pages,
      };
    }
    const batch = Array.isArray(json?.data) ? json.data : [];
    for (const row of batch) {
      const em = normalizeEmail(row?.email);
      if (em) emails.add(em);
    }
    pages += 1;
    const next = json?.meta?.next_cursor;
    if (!next || batch.length === 0) break;
    cursor = next;
  }
  return { emails, error: null, pages };
}

function fireForgetSyncPurchasedToSupabase(rows, buyerEmailSet) {
  if (!buyerEmailSet || buyerEmailSet.size === 0) return;
  const seen = new Set();
  for (const r of rows) {
    const em = normalizeEmail(r?.email);
    if (!em || !buyerEmailSet.has(em)) continue;
    if (toBool(r.purchased)) continue;
    const token = String(r?.token || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    void supabasePatch('webinaire_registrations', `token=eq.${encodeURIComponent(token)}`, {
      purchased: true,
    }).catch(() => {});
  }
}

function computeKpis(rows, buyerEmailSet) {
  const inscrits = rows.length;
  const presents = rows.filter((r) => toBool(r.attended_live)).length;
  const sawOffer = rows.filter((r) => toBool(r.saw_offer)).length;
  const clickedCta = rows.filter((r) => toBool(r.clicked_cta)).length;
  const watched30 = rows.filter((r) => toInt(r.watch_max_minutes) >= 30).length;
  const visitedSales = rows.filter((r) => toBool(r.visited_sales)).length;
  const watchedReplay = rows.filter((r) => toBool(r.watched_replay)).length;
  const acheteurs = rows.filter((r) => buyerEmailSet.has(normalizeEmail(r.email))).length;

  const presenceRate = inscrits > 0 ? (presents / inscrits) * 100 : 0;
  const ctaConversionRate = sawOffer > 0 ? (clickedCta / sawOffer) * 100 : 0;
  const conversionGlobalRate = inscrits > 0 ? (acheteurs / inscrits) * 100 : 0;
  const conversionPresentsRate = presents > 0 ? (acheteurs / presents) * 100 : 0;

  const richRows = rows.filter((r) => isRichCountry(r.pays));
  const autresRows = rows.filter((r) => !isRichCountry(r.pays));

  const funnel = [
    { id: 'inscrits', label: 'Inscrits', count: inscrits },
    { id: 'presents', label: 'Présents', count: presents },
    { id: 'watch30', label: 'Vu > 30 min', count: watched30 },
    { id: 'offer', label: 'Vu offre (CTA)', count: sawOffer },
    { id: 'clicked', label: 'Cliqué CTA', count: clickedCta },
    { id: 'sales', label: 'Page vente', count: visitedSales },
    { id: 'replay', label: 'Vu replay', count: watchedReplay },
  ].map((item) => ({
    ...item,
    percent: inscrits > 0 ? Math.max(0, Math.min(100, (item.count / inscrits) * 100)) : 0,
  }));

  return {
    cards: {
      inscrits,
      presents,
      presenceRate,
      sawOffer,
      clickedCta,
      ctaConversionRate,
      acheteurs,
      conversionGlobalRate,
      conversionPresentsRate,
    },
    funnel,
    countrySegments: [
      { segment: 'Pays riches', ...computeSegmentStats(richRows, buyerEmailSet) },
      { segment: 'Autres', ...computeSegmentStats(autresRows, buyerEmailSet) },
    ],
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  try {
    const url = new URL(req.url);
    const sessionDateFilter = String(url.searchParams.get('session_date') || '').trim(); // YYYY-MM-DD

    const res = await supabaseGet(
      'webinaire_registrations?select=token,email,prenom,pays,session_date,statut,attended_live,watch_max_minutes,saw_offer,clicked_cta,visited_sales,watched_replay,purchased,created_at&order=session_date.desc&limit=10000',
    );
    if (!res.ok) {
      return jsonResponse(500, { error: 'Erreur lecture base' });
    }

    const allRows = Array.isArray(res.data) ? res.data : [];
    const sessionDates = Array.from(
      new Set(
        allRows
          .map((r) => String(r?.session_date || '').slice(0, 10))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      ),
    ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    const filteredRows = sessionDateFilter
      ? allRows.filter((r) => String(r?.session_date || '').slice(0, 10) === sessionDateFilter)
      : allRows;

    const apiKey = process.env.MAILERLITE_API_KEY;
    const acheteursGroupId = String(process.env.MAILERLITE_GROUP_WEBINAIRE_ACHETEURS || '').trim();

    const mlBuyers = await fetchMailerLiteBuyerEmails(apiKey, acheteursGroupId);
    const buyerEmailSet = mlBuyers.error ? new Set() : mlBuyers.emails;

    if (!mlBuyers.error) {
      fireForgetSyncPurchasedToSupabase(filteredRows, buyerEmailSet);
    }

    const kpis = computeKpis(filteredRows, buyerEmailSet);

    return jsonResponse(200, {
      ok: true,
      filter: {
        session_date: sessionDateFilter || null,
      },
      sessions: sessionDates,
      totalRows: filteredRows.length,
      cards: kpis.cards,
      funnel: kpis.funnel,
      countrySegments: kpis.countrySegments,
      buyers: {
        source: 'mailerlite_group',
        groupEnv: 'MAILERLITE_GROUP_WEBINAIRE_ACHETEURS',
        groupIdConfigured: Boolean(acheteursGroupId),
        mailerLiteEmailsLoaded: mlBuyers.emails.size,
        mailerLitePages: mlBuyers.pages,
        error: mlBuyers.error,
      },
    });
  } catch (error) {
    console.error('admin-es2-dashboard-kpis error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
