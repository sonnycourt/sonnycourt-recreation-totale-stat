import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getSupabaseConfig, supabaseHeaders, supabasePatch } from './lib/supabase-rest.mjs';

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';

/** Liste « pays riches » — matching insensible à la casse et aux accents (colonne pays). */
const PAYS_RICHES = ['France', 'Belgique', 'Suisse', 'Canada', 'Luxembourg', 'Monaco', 'Allemagne'];

/** Checkpoints rétention vidéo (en minutes) — uniquement pour les sessions au format hérité. */
const RETENTION_CHECKPOINTS_MIN = [1, 15, 30, 45, 60, 75, 82];

/** Durée + minute d'apparition du CTA pour le format W2 (utilisé par la rétention nouvelle génération à la minute). */
const W2_LIVE_DURATION_MIN = 101;
const W2_LIVE_CTA_MIN = 89;
const W2_REPLAY_DURATION_MIN = 81;
const W2_REPLAY_CTA_MIN = 69;

/** Prix ES2 en € (utilisé pour calculer les valeurs financières par lead). Ajuster ici si le prix change. */
const ES2_OFFER_PRICE_EUR = 1997;

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
  const visitedSales = subset.filter((r) => toBool(r.visited_sales)).length;
  const watchedReplay = subset.filter((r) => toBool(r.watched_replay)).length;
  const acheteurs = subset.filter((r) => buyerEmailSet.has(normalizeEmail(r.email))).length;
  const presenceRate = inscrits > 0 ? (presents / inscrits) * 100 : 0;
  const salesConversionRate = visitedSales > 0 ? (acheteurs / visitedSales) * 100 : 0;
  return {
    inscrits,
    presents,
    presenceRate,
    sawOffer,
    clickedCta,
    visitedSales,
    watchedReplay,
    acheteurs,
    salesConversionRate,
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

/**
 * Benchmarks par étape (en % du précédent). [warn, good]
 * - en dessous de warn → rouge ; entre warn et good → jaune ; au-dessus de good → vert.
 */
const FUNNEL_BENCHMARKS = {
  presents: [55, 70],
  offer: [50, 65],
  clicked: [20, 40],
  sales: [60, 85],
  achat: [2, 5],
};

function buildFunnel(rows, buyerEmailSet) {
  const inscrits = rows.length;
  const presents = rows.filter((r) => toBool(r.attended_live)).length;
  const presentsReplay = rows.filter((r) => toBool(r.watched_replay)).length;
  const watched30 = rows.filter((r) => toBool(r.attended_live) && toInt(r.watch_max_minutes) >= 30).length;
  const watched30Replay = rows.filter((r) => toBool(r.watched_replay) && toInt(r.watch_max_minutes) >= 30).length;
  const sawOffer = rows.filter((r) => toBool(r.saw_offer)).length;
  const clickedCta = rows.filter((r) => toBool(r.clicked_cta)).length;
  const visitedSales = rows.filter((r) => toBool(r.visited_sales)).length;
  const acheteurs = rows.filter((r) => buyerEmailSet.has(normalizeEmail(r.email))).length;

  const steps = [
    { id: 'inscrits', label: 'Inscrits', count: inscrits, benchKey: null },
    {
      id: 'presents',
      label: 'Présents',
      count: presents + presentsReplay,
      benchKey: 'presents',
      split: { live: presents, replay: presentsReplay },
    },
    {
      id: 'watch30',
      label: 'Vu > 30 min',
      count: watched30 + watched30Replay,
      benchKey: null,
      split: { live: watched30, replay: watched30Replay },
    },
    { id: 'offer', label: 'Vu offre (CTA)', count: sawOffer, benchKey: 'offer' },
    { id: 'clicked', label: 'Cliqué CTA', count: clickedCta, benchKey: 'clicked' },
    { id: 'sales', label: 'Page de vente', count: visitedSales, benchKey: 'sales' },
    { id: 'achat', label: 'Acheté', count: acheteurs, benchKey: 'achat' },
  ];

  return steps.map((item, idx) => {
    const prev = idx > 0 ? steps[idx - 1].count : null;
    const stepRate = prev && prev > 0 ? (item.count / prev) * 100 : null;
    const percent = inscrits > 0 ? Math.max(0, Math.min(100, (item.count / inscrits) * 100)) : 0;
    const bench = item.benchKey ? FUNNEL_BENCHMARKS[item.benchKey] : null;
    return {
      id: item.id,
      label: item.label,
      count: item.count,
      percent,
      prevCount: prev,
      stepRate,
      benchmark: bench ? { warn: bench[0], good: bench[1] } : null,
      split: item.split || null,
    };
  });
}

function computeKpis(rows, buyerEmailSet) {
  const inscrits = rows.length;
  const presents = rows.filter((r) => toBool(r.attended_live)).length;
  const presentsReplay = rows.filter((r) => toBool(r.watched_replay)).length;
  const sawOffer = rows.filter((r) => toBool(r.saw_offer)).length;
  const clickedCta = rows.filter((r) => toBool(r.clicked_cta)).length;
  const visitedSales = rows.filter((r) => toBool(r.visited_sales)).length;
  const acheteurs = rows.filter((r) => buyerEmailSet.has(normalizeEmail(r.email))).length;

  const presenceRate = inscrits > 0 ? (presents / inscrits) * 100 : 0;
  const ctaConversionRate = sawOffer > 0 ? (clickedCta / sawOffer) * 100 : 0;
  const conversionGlobalRate = inscrits > 0 ? (acheteurs / inscrits) * 100 : 0;
  const conversionPresentsRate = presents > 0 ? (acheteurs / presents) * 100 : 0;

  const richRows = rows.filter((r) => isRichCountry(r.pays));
  const autresRows = rows.filter((r) => !isRichCountry(r.pays));
  const richBuyers = richRows.filter((r) => buyerEmailSet.has(normalizeEmail(r.email))).length;
  const conversionRichRate = richRows.length > 0 ? (richBuyers / richRows.length) * 100 : 0;

  const totalRevenueEur = acheteurs * ES2_OFFER_PRICE_EUR;
  const richRevenueEur = richBuyers * ES2_OFFER_PRICE_EUR;
  const valuePerLeadGlobal = inscrits > 0 ? totalRevenueEur / inscrits : 0;
  const valuePerLeadRich = richRows.length > 0 ? richRevenueEur / richRows.length : 0;

  const funnel = buildFunnel(rows, buyerEmailSet);

  // Détection du format de tracking pour la rétention :
  // - 'new' (W2+) : minute par minute, séparé live/replay, basé sur watch_max_seconds_live/replay
  // - 'legacy' (avant W2) : checkpoints sparses agrégés, basé sur watch_max_minutes
  const hasNewFormat = rows.some(
    (r) => toInt(r.watch_max_seconds_live) > 0 || toInt(r.watch_max_seconds_replay) > 0,
  );

  let retention;
  if (hasNewFormat) {
    function buildMinuteSeries(durationMin, secondsField) {
      const series = [];
      for (let minute = 1; minute <= durationMin; minute += 1) {
        const threshold = minute * 60;
        const rich = richRows.filter((r) => toInt(r[secondsField]) >= threshold).length;
        const other = autresRows.filter((r) => toInt(r[secondsField]) >= threshold).length;
        series.push({
          minute,
          rich,
          other,
          total: rich + other,
          richBase: richRows.length,
          otherBase: autresRows.length,
        });
      }
      return series;
    }
    retention = {
      kind: 'new',
      live: {
        durationMin: W2_LIVE_DURATION_MIN,
        ctaMin: W2_LIVE_CTA_MIN,
        series: buildMinuteSeries(W2_LIVE_DURATION_MIN, 'watch_max_seconds_live'),
      },
      replay: {
        durationMin: W2_REPLAY_DURATION_MIN,
        ctaMin: W2_REPLAY_CTA_MIN,
        series: buildMinuteSeries(W2_REPLAY_DURATION_MIN, 'watch_max_seconds_replay'),
      },
    };
  } else {
    retention = {
      kind: 'legacy',
      checkpoints: RETENTION_CHECKPOINTS_MIN.map((minute) => {
        const rich = richRows.filter((r) => toInt(r.watch_max_minutes) >= minute).length;
        const other = autresRows.filter((r) => toInt(r.watch_max_minutes) >= minute).length;
        return {
          minute,
          rich,
          other,
          total: rich + other,
          richBase: richRows.length,
          otherBase: autresRows.length,
        };
      }),
    };
  }

  const REPLAY_ACTIVE_WINDOW_MS = 15 * 60 * 1000;
  const nowMs = Date.now();
  const replayTotal = rows.filter((r) => toBool(r.watched_replay)).length;
  const replayActiveNow = rows.filter((r) => {
    if (!toBool(r.watched_replay)) return false;
    const ts = Date.parse(r?.last_event_at || '');
    return Number.isFinite(ts) && nowMs - ts < REPLAY_ACTIVE_WINDOW_MS;
  }).length;

  function liveReplayBreakdown(subset) {
    const liveOnly = subset.filter(
      (r) => toBool(r.attended_live) && !toBool(r.watched_replay),
    ).length;
    const replayOnly = subset.filter(
      (r) => !toBool(r.attended_live) && toBool(r.watched_replay),
    ).length;
    const liveAndReplay = subset.filter(
      (r) => toBool(r.attended_live) && toBool(r.watched_replay),
    ).length;
    const engaged = liveOnly + replayOnly + liveAndReplay;
    return { liveOnly, replayOnly, liveAndReplay, engaged };
  }

  const liveReplay = {
    rich: liveReplayBreakdown(richRows),
    other: liveReplayBreakdown(autresRows),
    total: liveReplayBreakdown(rows),
  };

  const buyerDetails = rows
    .filter((r) => buyerEmailSet.has(normalizeEmail(r.email)))
    .map((r) => ({
      prenom: String(r?.prenom || '').trim(),
      pays: String(r?.pays || '').trim(),
      isRich: isRichCountry(r?.pays),
      attendedLive: toBool(r.attended_live),
      watchedReplay: toBool(r.watched_replay),
      watchMaxMinutes: toInt(r.watch_max_minutes),
      clickedCta: toBool(r.clicked_cta),
      visitedSales: toBool(r.visited_sales),
      lastEventAt: r?.last_event_at || null,
      sessionDate: r?.session_date || null,
    }))
    .sort((a, b) => {
      const tb = Date.parse(b.lastEventAt || '') || 0;
      const ta = Date.parse(a.lastEventAt || '') || 0;
      return tb - ta;
    });

  return {
    cards: {
      inscrits,
      presents,
      presentsReplay,
      presenceRate,
      sawOffer,
      clickedCta,
      ctaConversionRate,
      visitedSales,
      acheteurs,
      conversionGlobalRate,
      conversionPresentsRate,
      conversionRichRate,
      valuePerLeadGlobal,
      valuePerLeadRich,
      offerPriceEur: ES2_OFFER_PRICE_EUR,
    },
    funnel,
    funnelBenchmarks: FUNNEL_BENCHMARKS,
    retention,
    replayTotal,
    replayActiveNow,
    liveReplay,
    buyerDetails,
    countrySegments: [
      { segment: 'Pays riches', ...computeSegmentStats(richRows, buyerEmailSet) },
      { segment: 'Autres', ...computeSegmentStats(autresRows, buyerEmailSet) },
    ],
  };
}

async function fetchAllRegistrations() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, error: 'Supabase non configuré', data: [] };
  }

  const pageSize = 1000;
  let offset = 0;
  const out = [];

  while (true) {
    const qs = new URLSearchParams({
      select: 'token,email,prenom,pays,session_date,statut,attended_live,watch_max_minutes,watch_max_seconds_live,watch_max_seconds_replay,saw_offer,clicked_cta,visited_sales,watched_replay,purchased,created_at,last_event_at',
      order: 'session_date.desc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const res = await fetch(`${url}/rest/v1/webinaire_registrations?${qs.toString()}`, {
      headers: supabaseHeaders(),
    });
    const json = await res.json().catch(() => []);
    if (!res.ok) {
      return { ok: false, error: 'Erreur lecture base', data: [] };
    }
    const batch = Array.isArray(json) ? json : [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return { ok: true, error: null, data: out };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  try {
    const url = new URL(req.url);
    const sessionDateFilter = String(url.searchParams.get('session_date') || '').trim(); // YYYY-MM-DD

    const res = await fetchAllRegistrations();
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
      funnelBenchmarks: kpis.funnelBenchmarks,
      retention: kpis.retention,
      replayTotal: kpis.replayTotal,
      replayActiveNow: kpis.replayActiveNow,
      liveReplay: kpis.liveReplay,
      buyerDetails: kpis.buyerDetails,
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
