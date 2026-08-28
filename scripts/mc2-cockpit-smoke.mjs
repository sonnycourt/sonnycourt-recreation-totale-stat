import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeMc2Cockpit } from '../netlify/functions/lib/mc2-cockpit.mjs';

const now = new Date('2026-08-28T12:00:00.000Z');
const baseRegistration = {
  registration_completed_at: '2026-08-28T10:00:00.000Z',
  registered_at: '2026-08-28T10:00:00.000Z',
  statut: 'registered',
  slot_kind: 'jit',
  session_starts_at: '2026-08-28T11:30:00.000Z',
  session_ends_at: '2026-08-28T13:15:00.000Z',
};

const payload = summarizeMc2Cockpit({
  now,
  presenceRows: [
    { token: 'a', stage: 'session', current_second: 120, is_playing: true, mode: 'real', updated_at: '2026-08-28T11:59:30.000Z' },
    { token: 'b', stage: 'replay', current_second: 90, is_playing: true, mode: 'real', updated_at: '2026-08-28T11:59:20.000Z' },
    { token: 'c', stage: 'waiting', current_second: 0, is_playing: false, mode: 'real', updated_at: '2026-08-28T11:59:10.000Z' },
    { token: 'test', stage: 'session', current_second: 50, is_playing: true, mode: 'test', updated_at: '2026-08-28T11:59:40.000Z' },
  ],
  recentRegistrations: [
    { ...baseRegistration, token: 'a', attended_live: true, saw_offer: true, checkout_view_count: 1 },
    { ...baseRegistration, token: 'b', watch_max_seconds_replay: 90, checkout_engaged: true, purchased_at: '2026-08-28T11:00:00.000Z' },
    { ...baseRegistration, token: 'c', slot_kind: 'scheduled', session_starts_at: '2026-08-28T13:00:00.000Z', session_ends_at: '2026-08-28T14:45:00.000Z' },
  ],
  scheduledRegistrations: [
    { ...baseRegistration, token: 'c', slot_kind: 'scheduled', session_starts_at: '2026-08-28T13:00:00.000Z', session_ends_at: '2026-08-28T14:45:00.000Z' },
  ],
  checkoutActuallySeenEvents: [
    { token: 'a' },
    { token: 'a' },
    { token: 'outside-recent-cohort' },
  ],
});

assert.equal(payload.presence.waiting, 1);
assert.equal(payload.presence.watchingSession, 1);
assert.equal(payload.presence.watchingReplay, 1);
assert.equal(payload.presence.activeTotal, 3);
assert.equal(payload.presence.tests, 1);
assert.equal(payload.presence.activeUnclassified, 0);
assert.equal(payload.funnel24h.registrations, 3);
assert.equal(payload.funnel24h.offer, 1);
assert.equal(payload.funnel24h.checkout, 2);
assert.equal(payload.funnel24h.checkoutActuallySeen, 1);
assert.equal(payload.funnel24h.purchases, 1);
assert.equal(payload.scheduledSessions.length, 1);
assert.equal(payload.scheduledSessions[0].waitingNow, 1);

const dashboard = fs.readFileSync(new URL('../src/pages/es-cockpit/dashboard.astro', import.meta.url), 'utf8');
const sessionPage = fs.readFileSync(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const replayPage = fs.readFileSync(new URL('../src/pages/mc2/replay.astro', import.meta.url), 'utf8');
const cockpitApi = fs.readFileSync(new URL('../netlify/functions/admin-mc2-cockpit-status.js', import.meta.url), 'utf8');
assert.match(dashboard, /id: 'mc2', label: 'MC2 Live'/);
assert.match(dashboard, /admin-mc2-cockpit-status/);
assert.match(dashboard, /mc2-watching-session/);
assert.match(dashboard, /mc2-scheduled-sessions/);
assert.match(dashboard, /mc2-funnel-checkout-seen/);
for (const page of [sessionPage, replayPage]) {
  assert.match(page, /trackCheckoutActuallySeen/);
  assert.match(page, /'checkout_actually_seen'/);
  assert.match(page, /document\.visibilityState !== 'visible'/);
  assert.match(page, /window\.setTimeout\(confirm, 1000\)/);
}
assert.match(cockpitApi, /event_name=eq\.checkout_actually_seen/);

console.log('mc2 cockpit smoke: ok');
