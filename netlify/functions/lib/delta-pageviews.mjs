import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const pageviewStore = () => getStore({ name: 'delta-anonymous-pageviews-v1', consistency: 'strong' });
export const hourKey = date => date.toISOString().slice(0, 13);
export const reply = (status, data) => new Response(data === undefined ? null : JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' },
});
export function makePageviewHandler({ store = pageviewStore, now = () => new Date() } = {}) {
  return async req => {
    if (req.method !== 'POST') return reply(405);
    const origin = new URL(req.url).origin;
    if (!['https://sonnycourt.com', 'https://www.sonnycourt.com'].includes(origin) ||
        req.headers.get('origin') !== origin || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403);
    const purpose = `${req.headers.get('purpose') || ''} ${req.headers.get('sec-purpose') || ''}`;
    // Read solely to discard obvious robots. Never persist IP, UA, headers or URLs.
    if (/bot|crawl|spider|preview|headless|monitor|curl|wget|python/i.test(req.headers.get('user-agent') || '') ||
        /prefetch|preview/i.test(purpose)) return reply(204);
    if (Number(req.headers.get('content-length') || 0) > 4) return reply(400);
    if (await req.text() !== 'view') return reply(400);
    try {
      // Independent writes avoid lost increments during concurrent arrivals.
      // The random key is server-only, identifies no visitor, and is never returned.
      await store().set(`${hourKey(now())}/${randomUUID()}`, '1');
      return reply(204);
    } catch { return reply(503); }
  };
}

export async function readPageviews(from, to, store = pageviewStore()) {
  const hours = new Map();
  let total = 0;
  for (let day = Math.floor(from / 86400000) * 86400000; day < to; day += 86400000) {
    const { blobs } = await store.list({ prefix: new Date(day).toISOString().slice(0, 10) + 'T' });
    for (const { key } of blobs) {
      const hour = key.slice(0, 13), at = Date.parse(hour + ':00:00Z');
      if (at < from || at >= to || !Number.isFinite(at)) continue;
      hours.set(hour, (hours.get(hour) || 0) + 1);
      if (++total > 50000) throw new Error('report_too_large');
    }
  }
  return { pageviews: total, hours: [...hours].sort(([a], [b]) => a.localeCompare(b)).map(([hour, count]) => ({ hour: hour + ':00:00Z', count })) };
}

export async function prunePageviews(now = new Date(), store = pageviewStore()) {
  const cutoff = hourKey(new Date(now.getTime() - 90 * 86400000));
  const { directories } = await store.list({ directories: true });
  for (const prefix of directories) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}\/$/.test(prefix) || prefix.slice(0, 13) >= cutoff) continue;
    const { blobs } = await store.list({ prefix });
    for (let i = 0; i < blobs.length; i += 20) await Promise.all(blobs.slice(i, i + 20).map(({ key }) => store.delete(key)));
  }
}
