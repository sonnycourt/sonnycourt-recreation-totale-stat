#!/usr/bin/env node

/**
 * One-shot script:
 * - Lists MailerLite subscribers
 * - Finds those with es_session_date in FROM_VALUES
 * - Updates es_session_date to TO_VALUE
 *
 * Usage:
 *   MAILERLITE_API_KEY=xxx node scripts/update-mailerlite-es-session-date.mjs
 *
 * Optional env:
 *   DRY_RUN=true|false                (default: true)
 *   FROM_VALUES=2026-05-07,07/05/2026
 *   TO_VALUE=2026-05-14
 *   PAGE_LIMIT=100
 *   REQUEST_DELAY_MS=120
 *   MAX_RETRIES=6
 */

const API_BASE = 'https://connect.mailerlite.com/api';

const API_KEY = String(process.env.MAILERLITE_API_KEY || '').trim();
const DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const FROM_VALUES = String(process.env.FROM_VALUES || '2026-05-07')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const TO_VALUE = String(process.env.TO_VALUE || '2026-05-14').trim();
const PAGE_LIMIT = Math.min(Math.max(Number(process.env.PAGE_LIMIT || 100), 1), 100);
const REQUEST_DELAY_MS = Math.max(Number(process.env.REQUEST_DELAY_MS || 120), 0);
const MAX_RETRIES = Math.max(Number(process.env.MAX_RETRIES || 6), 1);

if (!API_KEY) {
  console.error('Missing MAILERLITE_API_KEY');
  process.exit(1);
}
if (!TO_VALUE) {
  console.error('Missing TO_VALUE');
  process.exit(1);
}
if (!FROM_VALUES.length) {
  console.error('FROM_VALUES is empty');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(res, fallbackMs) {
  const raw = res.headers.get('retry-after');
  if (!raw) return fallbackMs;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
  const ts = Date.parse(raw);
  if (Number.isFinite(ts)) {
    const delta = ts - Date.now();
    return delta > 0 ? delta : fallbackMs;
  }
  return fallbackMs;
}

async function fetchWithRetry(url, options = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_RETRIES) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        attempt += 1;
        const waitMs = parseRetryAfterMs(res, Math.min(1000 * 2 ** attempt, 15000));
        console.warn(`[rate-limit] ${options.method || 'GET'} ${url} -> 429, retry in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500 && res.status <= 599) {
        attempt += 1;
        const waitMs = Math.min(1000 * 2 ** attempt, 15000);
        console.warn(`[server-error] ${options.method || 'GET'} ${url} -> ${res.status}, retry in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      attempt += 1;
      const waitMs = Math.min(1000 * 2 ** attempt, 15000);
      console.warn(`[network-error] ${options.method || 'GET'} ${url} -> ${err?.message || err}, retry in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  if (lastError) throw lastError;
  throw new Error(`Failed after ${MAX_RETRIES} retries: ${options.method || 'GET'} ${url}`);
}

function getEsSessionDate(subscriber) {
  // MailerLite may return custom fields in slightly different shapes.
  const fieldsObj = subscriber?.fields;
  if (fieldsObj && typeof fieldsObj === 'object' && !Array.isArray(fieldsObj)) {
    return String(fieldsObj.es_session_date || '').trim();
  }

  const fieldsArr = Array.isArray(subscriber?.fields) ? subscriber.fields : [];
  for (const f of fieldsArr) {
    const key = String(f?.key || f?.name || '').trim();
    if (key === 'es_session_date') return String(f?.value || '').trim();
  }

  const customFields = Array.isArray(subscriber?.custom_fields) ? subscriber.custom_fields : [];
  for (const f of customFields) {
    const key = String(f?.key || f?.name || '').trim();
    if (key === 'es_session_date') return String(f?.value || '').trim();
  }

  return '';
}

function getSubscriberEmail(subscriber) {
  return String(subscriber?.email || subscriber?.attributes?.email || '').trim().toLowerCase();
}

function buildInitialListUrl() {
  return `${API_BASE}/subscribers?limit=${PAGE_LIMIT}`;
}

function normalizeNextUrl(nextUrl) {
  const raw = String(nextUrl || '').trim();
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (raw.startsWith('/')) return `${API_BASE}${raw.replace(/^\/api/, '')}`;
  return `${API_BASE}/${raw.replace(/^\/+/, '')}`;
}

function extractNextUrl(body) {
  // MailerLite v2 typically exposes pagination through links.next.
  const byLinks = normalizeNextUrl(body?.links?.next);
  if (byLinks) return byLinks;

  // Defensive fallback for cursor-based variants.
  const cursor = String(body?.meta?.next_cursor || '').trim();
  if (cursor) {
    return `${API_BASE}/subscribers?limit=${PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`;
  }
  return null;
}

async function listSubscribersPage(url) {
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`List subscribers failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  const data = Array.isArray(body?.data) ? body.data : [];
  const nextUrl = extractNextUrl(body);
  return { data, nextUrl };
}

async function updateSubscriberDate(subscriberId, newValue) {
  const url = `${API_BASE}/subscribers/${encodeURIComponent(String(subscriberId))}`;
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      fields: {
        es_session_date: newValue,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Update failed HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log('--- MailerLite es_session_date migration ---');
  console.log(`DRY_RUN=${DRY_RUN}`);
  console.log(`FROM_VALUES=${FROM_VALUES.join(', ')}`);
  console.log(`TO_VALUE=${TO_VALUE}`);
  console.log(`PAGE_LIMIT=${PAGE_LIMIT}`);

  let page = 1;
  let listUrl = buildInitialListUrl();
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  const failures = [];
  const seenListUrls = new Set();
  const seenSubscriberIds = new Set();
  const seenMatchedEmails = new Set();
  const dedupedMatches = [];

  while (listUrl) {
    if (seenListUrls.has(listUrl)) {
      console.warn(`[pagination-stop] repeated next url detected on page ${page}. Stopping.`);
      break;
    }
    seenListUrls.add(listUrl);

    const { data, nextUrl } = await listSubscribersPage(listUrl);
    if (!data.length) break;

    scanned += data.length;
    console.log(`\n[page ${page}] subscribers=${data.length} scanned_total=${scanned}`);

    for (const sub of data) {
      const subscriberId = String(sub?.id || '').trim();
      if (subscriberId) {
        if (seenSubscriberIds.has(subscriberId)) continue;
        seenSubscriberIds.add(subscriberId);
      }
      const email = getSubscriberEmail(sub) || `(no-email:${subscriberId || 'unknown'})`;
      const oldValue = getEsSessionDate(sub);
      if (!oldValue || !FROM_VALUES.includes(oldValue)) continue;

      if (!seenMatchedEmails.has(email)) {
        seenMatchedEmails.add(email);
        dedupedMatches.push({ email, from: oldValue, to: TO_VALUE });
      }
      matched += 1;

      if (DRY_RUN) {
        console.log(`[DRY-RUN] ${email} | es_session_date: ${oldValue} -> ${TO_VALUE}`);
        continue;
      }

      if (!subscriberId) {
        const msg = `Missing subscriber id for ${email}`;
        console.error(`[ERROR] ${msg}`);
        failures.push(msg);
        continue;
      }

      try {
        await updateSubscriberDate(subscriberId, TO_VALUE);
        updated += 1;
        console.log(`[UPDATED] ${email} | es_session_date: ${oldValue} -> ${TO_VALUE}`);
      } catch (err) {
        const msg = `${email} | ${oldValue} -> ${TO_VALUE} | ${err?.message || err}`;
        console.error(`[ERROR] ${msg}`);
        failures.push(msg);
      }

      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    }

    if (!nextUrl) break;
    listUrl = nextUrl;
    page += 1;
  }

  console.log('\n--- Summary ---');
  console.log(`scanned=${scanned}`);
  console.log(`matched_total_rows=${matched}`);
  console.log(`matched_unique_contacts=${dedupedMatches.length}`);
  console.log(`updated=${updated}`);
  console.log(`failures=${failures.length}`);

  console.log('\n--- Deduped matches (email | from -> to) ---');
  dedupedMatches
    .sort((a, b) => a.email.localeCompare(b.email))
    .forEach((item) => console.log(`${item.email} | ${item.from} -> ${item.to}`));

  if (failures.length) {
    console.log('\nFailure details:');
    failures.forEach((f) => console.log(`- ${f}`));
  }
}

main().catch((err) => {
  console.error('[FATAL]', err?.message || err);
  process.exit(1);
});
