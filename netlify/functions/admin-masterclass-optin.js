import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';

const EVENT_ORDER = [
  'page_view',
  'cta_clicked',
  'popup_opened',
  'step_1_completed',
  'step_2_completed',
  'commitment_checked',
  'registration_submitted',
  'registration_completed',
];
const RICH_COUNTRIES = new Set(['FR', 'BE', 'CH', 'CA', 'LU', 'MC', 'DE']);
const MAX_DAYS = 120;
const PAGE_SIZE = 1000;
const MAX_ROWS = 50000;
const SOURCE_ORDER = ['all', 'organic', 'meta_ad', 'tiktok_ad', 'other'];

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function isoOrNull(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function fetchEvents(from, to) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase non configuré');

  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const qs = new URLSearchParams({
      select:
        'funnel_id,event_name,variant,path,traffic_source,country_code,selected_country,session_date,created_at',
      created_at: `gte.${from}`,
      order: 'created_at.asc',
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    qs.append('created_at', `lte.${to}`);

    const response = await fetch(`${url}/rest/v1/masterclass_optin_events?${qs.toString()}`, {
      headers: supabaseHeaders(),
    });
    const batch = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(batch)) {
      throw new Error(`Lecture Supabase impossible (${response.status})`);
    }
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function emptyCounts() {
  return Object.fromEntries(EVENT_ORDER.map((name) => [name, 0]));
}

function normalizeSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return 'organic';
  if (source === 'meta_ad' || source === 'tiktok_ad') return source;
  return 'other';
}

function summarize(rows) {
  const funnels = new Map();
  for (const row of rows) {
    const id = String(row.funnel_id || '');
    if (!id) continue;
    if (!funnels.has(id)) {
      funnels.set(id, {
        id,
        variant: row.variant || 'v2',
        source: normalizeSource(row.traffic_source),
        countryCode: null,
        selectedCountry: null,
        sessionDate: row.session_date || null,
        events: new Set(),
      });
    }
    const funnel = funnels.get(id);
    funnel.events.add(row.event_name);
    if (row.event_name === 'page_view' && row.country_code) {
      funnel.countryCode = String(row.country_code).toUpperCase();
    } else if (!funnel.countryCode && row.country_code) {
      funnel.countryCode = String(row.country_code).toUpperCase();
    }
    if (row.selected_country) funnel.selectedCountry = row.selected_country;
    if (!funnel.sessionDate && row.session_date) funnel.sessionDate = row.session_date;
  }

  const groups = new Map();
  const ensure = (variant, source, segment) => {
    const key = `${variant}::${source}::${segment}`;
    if (!groups.has(key)) {
      groups.set(key, { variant, source, segment, counts: emptyCounts() });
    }
    return groups.get(key);
  };

  const trackedFunnelsBySource = {
    organic: 0,
    meta_ad: 0,
    tiktok_ad: 0,
    other: 0,
  };

  for (const funnel of funnels.values()) {
    trackedFunnelsBySource[funnel.source] += 1;
    const segment = funnel.countryCode
      ? RICH_COUNTRIES.has(funnel.countryCode)
        ? 'pays_forts'
        : 'autres'
      : 'inconnu';
    for (const target of [
      ensure(funnel.variant, 'all', 'global'),
      ensure(funnel.variant, 'all', segment),
      ensure(funnel.variant, funnel.source, 'global'),
      ensure(funnel.variant, funnel.source, segment),
    ]) {
      for (const eventName of EVENT_ORDER) {
        if (funnel.events.has(eventName)) target.counts[eventName] += 1;
      }
    }
  }

  const results = Array.from(groups.values()).map((group) => {
    const views = group.counts.page_view;
    const steps = EVENT_ORDER.map((name, index) => {
      const count = group.counts[name];
      const previousName = index > 0 ? EVENT_ORDER[index - 1] : null;
      const previous = previousName ? group.counts[previousName] : null;
      return {
        name,
        count,
        from_view_rate: views > 0 ? (count / views) * 100 : null,
        previous_rate: previous && previous > 0 ? (count / previous) * 100 : null,
      };
    });
    return {
      variant: group.variant,
      source: group.source,
      segment: group.segment,
      counts: group.counts,
      conversion_rate:
        views > 0 ? (group.counts.registration_completed / views) * 100 : null,
      steps,
    };
  });

  return {
    tracked_funnels: funnels.size,
    tracked_funnels_by_source: trackedFunnelsBySource,
    groups: results.sort((a, b) => {
      const sourceDelta = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
      return sourceDelta || `${a.variant}:${a.segment}`.localeCompare(`${b.variant}:${b.segment}`);
    }),
  };
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });

  const requestUrl = new URL(req.url);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = isoOrNull(requestUrl.searchParams.get('from')) || defaultFrom.toISOString();
  const to = isoOrNull(requestUrl.searchParams.get('to')) || now.toISOString();
  const span = Date.parse(to) - Date.parse(from);
  if (span < 0 || span > MAX_DAYS * 24 * 60 * 60 * 1000) {
    return json(400, { error: `Période invalide (maximum ${MAX_DAYS} jours)` });
  }

  try {
    const rows = await fetchEvents(from, to);
    return json(200, {
      from,
      to,
      generated_at: new Date().toISOString(),
      truncated: rows.length >= MAX_ROWS,
      ...summarize(rows),
    });
  } catch (error) {
    console.error('admin-masterclass-optin:', error);
    return json(500, { error: error.message || 'Erreur serveur' });
  }
};
