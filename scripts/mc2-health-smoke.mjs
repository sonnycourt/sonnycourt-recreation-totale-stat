import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  overallHealth,
  summarizeFunnel,
  summarizePages,
  summarizeQueue,
} from '../netlify/functions/lib/mc2-health.mjs';

const now = new Date('2026-08-14T12:00:00.000Z');
const root = new URL('../', import.meta.url);
const endpoint = await readFile(new URL('netlify/functions/mc2-health.js', root), 'utf8');
const page = await readFile(new URL('src/pages/mc2-sante.astro', root), 'utf8');
const hub = await readFile(new URL('src/pages/hub.astro', root), 'utf8');

assert.match(endpoint, /getSessionFromRequest/);
assert.doesNotMatch(endpoint, /supabase(Post|Patch|Delete|Upsert)/);
assert.doesNotMatch(endpoint, /select=[^'`\n]*(email|telephone|prenom|token|stripe_customer_id)/);
assert.match(page, /Aucune donnée personnelle/);
assert.match(page, /credentials: 'same-origin'/);
assert.match(page, /window\.location\.replace\('\/hub'\)/);
assert.match(hub, /<h2>MC2<\/h2>/);
assert.match(hub, /href="\/mc2-sante"/);

const healthyQueue = summarizeQueue({
  id: 'sms', name: 'SMS', description: 'test', enabled: true, configured: true, now,
  result: { ok: true, data: [{ status: 'sent', due_at: '2026-08-14T11:00:00.000Z', sent_at: '2026-08-14T11:00:03.000Z' }] },
});
assert.equal(healthyQueue.status, 'green');

const lateQueue = summarizeQueue({
  id: 'sms', name: 'SMS', description: 'test', enabled: true, configured: true, now,
  result: { ok: true, data: [{ status: 'pending', due_at: '2026-08-14T11:52:00.000Z' }] },
});
assert.equal(lateQueue.status, 'orange');

const blockedQueue = summarizeQueue({
  id: 'sms', name: 'SMS', description: 'test', enabled: true, configured: true, now,
  result: { ok: true, data: [
    { status: 'pending', due_at: '2026-08-14T11:50:00.000Z' },
    { status: 'retry', due_at: '2026-08-14T11:49:00.000Z', last_error: 'provider 500' },
    { status: 'pending', due_at: '2026-08-14T11:48:00.000Z' },
  ] },
});
assert.equal(blockedQueue.status, 'red');
assert.equal(blockedQueue.lastError, 'Fournisseur temporairement indisponible');

const unknownQueue = summarizeQueue({
  id: 'replay', name: 'Replay', description: 'test', enabled: false, configured: true, now,
  result: { ok: true, data: [] },
});
assert.equal(unknownQueue.status, 'unknown');
assert.equal(unknownQueue.affectsOverall, false);

const idleQueue = summarizeQueue({
  id: 'emails', name: 'Emails', description: 'test', enabled: true, configured: true, now,
  result: { ok: true, data: [] },
});
assert.equal(idleQueue.status, 'unknown');

const noTraffic = summarizeFunnel({
  registrationsResult: { ok: true, data: [] },
  optinsResult: { ok: true, data: [] },
  presenceResult: { ok: true, data: [] },
  now,
});
assert.equal(noTraffic.status, 'unknown');

const blockedFlow = summarizeFunnel({
  registrationsResult: { ok: true, data: [] },
  optinsResult: {
    ok: true,
    data: Array.from({ length: 5 }, (_, index) => ({
      funnel_id: `funnel-${index}`,
      event_name: 'page_view',
      occurred_at: '2026-08-14T11:30:00.000Z',
    })),
  },
  presenceResult: { ok: true, data: [] },
  now,
});
assert.equal(blockedFlow.status, 'red');

const pages = summarizePages([
  { label: 'MC2', status: 'green' },
  { label: 'Checkout', status: 'orange' },
], now);
assert.equal(pages.status, 'orange');

const overall = overallHealth([
  { status: 'green', affectsOverall: true },
  { status: 'unknown', affectsOverall: true },
  { status: 'red', affectsOverall: false },
], now);
assert.equal(overall.status, 'unknown');

const { default: healthEndpoint } = await import('../netlify/functions/mc2-health.js');
const unauthenticated = await healthEndpoint(new Request('https://sonnycourt.com/.netlify/functions/mc2-health'));
assert.equal(unauthenticated.status, 401);

console.log('MC2 health smoke: OK');
