import crypto from 'node:crypto';
import { getSupabaseConfig } from './supabase-rest.mjs';
import { UUID, CODE, DESTINATIONS } from '../../../src/lib/marketing-links-contract.mjs';

export const COOKIE = 'sc_journey_v1';
export const MAX_AGE = 90 * 86400;
export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', ...extra } });
}
export function sameOrigin(req, required = false) {
  return req.headers.get('sec-fetch-site') !== 'cross-site' && (!required && !req.headers.get('origin') || req.headers.get('origin') === new URL(req.url).origin);
}
export function productionRequest(req) { return ['sonnycourt.com', 'www.sonnycourt.com'].includes(new URL(req.url).hostname); }
export async function database(path, body, { timeout = 5000, prefer = 'return=representation' } = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('database_unavailable');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // Never propagate DB details or request/customer payloads to logs or clients.
    const error = new Error(['42P01', '42883', 'PGRST202', 'PGRST205'].includes(data?.code) ? 'schema_missing' : 'database_unavailable');
    error.status = response.status; throw error;
  }
  return data;
}
function secret() {
  const { key } = getSupabaseConfig();
  return key ? crypto.createHash('sha256').update(`marketing-links-v1|${key}`).digest() : null;
}
export function sign(kind, payload) {
  const key = secret(); if (!key) return '';
  const data = Buffer.from(JSON.stringify({ ...payload, kind })).toString('base64url');
  return `${data}.${crypto.createHmac('sha256', key).update(data).digest('base64url')}`;
}
export function verify(kind, value, now = Date.now()) {
  try {
    if (typeof value !== 'string' || value.length > 1400) return null;
    const [data, signature, extra] = value.split('.'), key = secret();
    if (!key || !data || !signature || extra) return null;
    const actual = Buffer.from(signature, 'base64url'), expected = crypto.createHmac('sha256', key).update(data).digest();
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.kind === kind && Number.isFinite(payload.exp) && payload.exp > now ? payload : null;
  } catch { return null; }
}
export function cookieValue(req, name) {
  try { return decodeURIComponent((req.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || ''); } catch { return ''; }
}
export function visitorCookie(value, seconds = MAX_AGE) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`;
}
export function validReceipt(value) {
  const r = verify('arrival', value);
  return r && UUID.test(r.event_id || '') && CODE.test(r.code || '') && (!r.visitor_id || UUID.test(r.visitor_id)) ? r : null;
}
export function isDestinationPath(destination, path) {
  const expected = DESTINATIONS[destination];
  return expected && typeof path === 'string' && path.replace(/\/$/, '') === new URL(expected.url).pathname.replace(/\/$/, '');
}
export async function recordMarketingRegistration(req, row, receipt, statisticsConsent = false) {
  // Analytics is additive; neither missing SQL nor a timeout can fail registration.
  if (!productionRequest(req) || !row?.token) return false;
  const r = validReceipt(receipt);
  const visitor = statisticsConsent === true ? verify('visitor', cookieValue(req, COOKIE)) : null;
  const visitorId = visitor && UUID.test(visitor.id || '') ? visitor.id : null;
  if (!r && !visitorId) return false;
  try {
    await database('rpc/marketing_link_mc2_registration', { p_token: row.token, p_event_id: r?.event_id || null, p_code: r?.code || null, p_visitor_id: visitorId }, { timeout: 900 });
    return true;
  } catch { return false; }
}
