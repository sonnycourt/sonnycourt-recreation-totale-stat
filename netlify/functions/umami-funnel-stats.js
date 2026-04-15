import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';

const FUNNEL_PAGES = [
  { path: '/masterclass', name: 'Opt-in' },
  { path: '/masterclass/confirmation', name: 'Confirmation' },
  { path: '/masterclass/session', name: 'Session masterclass' },
  { path: '/invitation', name: 'Invitation (sales)' },
  { path: '/masterclass/success', name: 'Success' },
];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(num, den) {
  if (!den) return 0;
  return Number(((num / den) * 100).toFixed(1));
}

function normalizePath(value) {
  if (!value) return '';
  const s = String(value).trim();
  try {
    if (s.startsWith('http://') || s.startsWith('https://')) {
      const u = new URL(s);
      return `${u.pathname}${u.search || ''}`;
    }
  } catch {
    // ignore
  }
  return s;
}

function rowLabel(row) {
  return String(
    row.x ??
      row.name ??
      row.label ??
      row.value ??
      ''
  ).trim();
}

function rowValue(row) {
  return toNum(row.y ?? row.count ?? row.value ?? row.total ?? 0);
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

async function umamiLogin(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Umami login failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data?.token) throw new Error('Umami login succeeded without token');
  return data.token;
}

async function umamiGet(baseUrl, auth, path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    qs.set(k, String(v));
  });
  const url = `${baseUrl}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      ...(auth.type === 'api-key'
        ? { 'x-umami-api-key': auth.value }
        : { Authorization: `Bearer ${auth.value}` }),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Umami GET ${path} failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function aggregateRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const label = rowLabel(row);
    if (!label) continue;
    map.set(label, (map.get(label) || 0) + rowValue(row));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function normalizeSource(name) {
  const n = name.toLowerCase();
  if (!n || n === '(none)' || n === 'direct' || n === 'direct / none') return 'Direct';
  if (n.includes('instagram') || n.includes('ig')) return 'Instagram';
  if (n.includes('tiktok')) return 'TikTok';
  if (n.includes('youtube') || n.includes('youtu.be')) return 'YouTube';
  if (n.includes('mail') || n.includes('newsletter')) return 'Email';
  return name;
}

function topSources(rows) {
  const agg = new Map();
  for (const r of rows) {
    const key = normalizeSource(r.name || '');
    agg.set(key, (agg.get(key) || 0) + toNum(r.value));
  }
  return [...agg.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

function topCountries(rows) {
  return rows
    .map((r) => ({ name: (r.name || 'Unknown').toUpperCase(), value: toNum(r.value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
}

function deviceSplit(rows) {
  const buckets = { mobile: 0, desktop: 0, tablet: 0 };
  for (const r of rows) {
    const n = (r.name || '').toLowerCase();
    const v = toNum(r.value);
    if (n.includes('mobile')) buckets.mobile += v;
    else if (n.includes('tablet')) buckets.tablet += v;
    else buckets.desktop += v;
  }
  const total = buckets.mobile + buckets.desktop + buckets.tablet;
  return {
    mobile: pct(buckets.mobile, total),
    desktop: pct(buckets.desktop, total),
    tablet: pct(buckets.tablet, total),
  };
}

async function resolveUrlVariants(baseUrl, auth, websiteId, startAt, endAt, pagePath) {
  // Umami self-hosted garde souvent la query string dans les URLs.
  // On récupère la distribution des URLs puis on filtre en startsWith côté serveur.
  const urlsRaw = await umamiGet(
    baseUrl,
    auth,
    `/api/websites/${websiteId}/metrics`,
    { startAt, endAt, type: 'url', limit: 1000 }
  );
  const rows = extractRows(urlsRaw);
  const variants = rows
    .map((r) => ({ path: normalizePath(rowLabel(r)), value: rowValue(r) }))
    .filter((r) => r.path && r.path.startsWith(pagePath))
    .sort((a, b) => b.value - a.value)
    .map((r) => r.path);
  if (variants.length) return variants;
  return [pagePath];
}

async function fetchVariantData(baseUrl, auth, websiteId, startAt, endAt, url) {
  const [statsRaw, sourcesRaw, countriesRaw, devicesRaw] = await Promise.all([
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/stats`, { startAt, endAt, url }),
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/metrics`, { startAt, endAt, type: 'referrer', url, limit: 50 }),
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/metrics`, { startAt, endAt, type: 'country', url, limit: 50 }),
    umamiGet(baseUrl, auth, `/api/websites/${websiteId}/metrics`, { startAt, endAt, type: 'device', url, limit: 50 }),
  ]);

  const stats = {
    pageviews: toNum(statsRaw?.pageviews),
    visitors: toNum(statsRaw?.visitors),
    bounces: toNum(statsRaw?.bounces),
    totaltime: toNum(statsRaw?.totaltime),
  };
  return {
    stats,
    sources: aggregateRows(extractRows(sourcesRaw)),
    countries: aggregateRows(extractRows(countriesRaw)),
    devices: aggregateRows(extractRows(devicesRaw)),
  };
}

async function buildPageStats(baseUrl, auth, websiteId, startAt, endAt, page) {
  const variants = await resolveUrlVariants(baseUrl, auth, websiteId, startAt, endAt, page.path);
  const variantData = await Promise.all(
    variants.map((u) => fetchVariantData(baseUrl, auth, websiteId, startAt, endAt, u))
  );

  const totals = {
    pageviews: 0,
    visitors: 0,
    bounces: 0,
    totaltime: 0,
    sources: [],
    countries: [],
    devices: [],
  };

  for (const v of variantData) {
    totals.pageviews += v.stats.pageviews;
    totals.visitors += v.stats.visitors;
    totals.bounces += v.stats.bounces;
    totals.totaltime += v.stats.totaltime;
    totals.sources.push(...v.sources);
    totals.countries.push(...v.countries);
    totals.devices.push(...v.devices);
  }

  const avgTime = totals.visitors > 0 ? Math.round(totals.totaltime / totals.visitors) : 0;
  const bounceRate = pct(totals.bounces, totals.pageviews);

  return {
    path: page.path,
    name: page.name,
    pageviews: totals.pageviews,
    visitors: totals.visitors,
    avgTime,
    bounceRate,
    topSources: topSources(totals.sources),
    topCountries: topCountries(totals.countries),
    devices: deviceSplit(totals.devices),
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  // Protection cockpit : cookie admin obligatoire
  if (process.env.ADMIN_DEV_BYPASS !== 'true') {
    const session = getSessionFromRequest(req);
    if (!session) return json(401, { error: 'Unauthorized' });
  }

  const url = new URL(req.url);
  const startAt = toNum(url.searchParams.get('startAt'));
  const endAt = toNum(url.searchParams.get('endAt'));
  if (!startAt || !endAt || startAt >= endAt) {
    return json(400, { error: 'startAt/endAt invalides' });
  }

  const isDevBypass = process.env.ADMIN_DEV_BYPASS === 'true';
  const baseUrl = (process.env.UMAMI_BASE_URL || '').replace(/\/+$/, '');
  const websiteId = process.env.UMAMI_WEBSITE_ID || '';
  const apiKey = process.env.UMAMI_API_KEY || '';
  const username = process.env.UMAMI_USERNAME || '';
  const password = process.env.UMAMI_PASSWORD || '';

  if (!baseUrl || !websiteId || (!apiKey && (!username || !password))) {
    if (isDevBypass) {
      const mockVisitors = [1200, 980, 760, 510, 140];
      const mockPages = FUNNEL_PAGES.map((p, i) => ({
        path: p.path,
        name: `${p.name} (mock)`,
        pageviews: mockVisitors[i] + 200,
        visitors: mockVisitors[i],
        avgTime: 45 + i * 18,
        bounceRate: 25 + i * 8,
        topSources: [
          { name: 'Instagram', value: 420 - i * 30 },
          { name: 'Direct', value: 280 - i * 20 },
          { name: 'YouTube', value: 190 - i * 12 },
        ],
        topCountries: [
          { name: 'FR', value: 700 - i * 35 },
          { name: 'BE', value: 120 - i * 6 },
          { name: 'CH', value: 90 - i * 5 },
        ],
        devices: { mobile: 74, desktop: 23, tablet: 3 },
      }));
      return json(200, {
        period: { startAt, endAt },
        pages: mockPages,
        mock: true,
      });
    }
    return json(500, {
      error:
        'Umami env vars manquantes: UMAMI_BASE_URL, UMAMI_WEBSITE_ID, et (UMAMI_API_KEY ou UMAMI_USERNAME + UMAMI_PASSWORD)',
    });
  }

  try {
    const auth = apiKey
      ? { type: 'api-key', value: apiKey }
      : { type: 'bearer', value: await umamiLogin(baseUrl, username, password) };
    const pages = await Promise.all(
      FUNNEL_PAGES.map((p) => buildPageStats(baseUrl, auth, websiteId, startAt, endAt, p))
    );
    return json(200, {
      period: { startAt, endAt },
      pages,
    });
  } catch (err) {
    return json(503, {
      error: 'Umami indisponible',
      detail: err instanceof Error ? err.message : 'Erreur inconnue',
    });
  }
};

