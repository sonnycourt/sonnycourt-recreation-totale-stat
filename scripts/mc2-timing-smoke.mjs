import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MC2_LIVE_CTA_SECONDS,
  MC2_LIVE_VIDEO_DURATION_SECONDS,
  MC2_LIVE_VIDEO_LEAD_SECONDS,
  MC2_REPLAY_CTA_SECONDS,
  MC2_SESSION_DURATION_MS,
  MC2_SESSION_DURATION_SECONDS,
  mc2SessionEndsAt,
  mc2SessionEndsAtIso,
} from '../src/lib/mc2-timing.mjs';
import {
  mc2SessionDurationMs,
  validateMc2SessionSelection,
} from '../netlify/functions/lib/mc2-session.mjs';

assert.equal(MC2_LIVE_VIDEO_LEAD_SECONDS, 15 * 60);
assert.equal(MC2_LIVE_VIDEO_DURATION_SECONDS, 8_048);
assert.equal(MC2_SESSION_DURATION_SECONDS, 7_148);
assert.equal(MC2_SESSION_DURATION_MS, 7_148_000);
assert.equal(MC2_LIVE_CTA_SECONDS, 99 * 60);
assert.equal(MC2_REPLAY_CTA_SECONDS, 79 * 60);
assert.equal(mc2SessionDurationMs(), MC2_SESSION_DURATION_MS);

const sessionStart = '2026-08-26T18:00:00.000Z';
assert.equal(mc2SessionEndsAt(sessionStart).toISOString(), '2026-08-26T19:59:08.000Z');
assert.equal(mc2SessionEndsAtIso(sessionStart), '2026-08-26T19:59:08.000Z');
assert.equal(mc2SessionEndsAtIso('invalid'), null);

const selection = validateMc2SessionSelection({
  sessionStartsAt: sessionStart,
  slotKind: 'jit',
  visitorTimezone: 'Europe/Paris',
}, new Date('2026-08-26T17:50:00.000Z'));
assert.equal(selection.ok, true);
assert.equal(selection.sessionEndsAt.toISOString(), '2026-08-26T19:59:08.000Z');

const sessionPage = await readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const confirmationPage = await readFile(new URL('../src/pages/mc2/confirmation.astro', import.meta.url), 'utf8');
const getRegistration = await readFile(new URL('../netlify/functions/get-mc2-registration.js', import.meta.url), 'utf8');
const eligibility = await readFile(new URL('../netlify/functions/check-mc2-eligibility.js', import.meta.url), 'utf8');

assert.match(sessionPage, /function getBroadcastEndMs\(\)/);
assert.match(sessionPage, /return liveStartMs \+ getVideoDurationSeconds\(\) \* 1000/);
assert.doesNotMatch(sessionPage, /new Date\(reg\.sessionEndsAt/);
assert.doesNotMatch(sessionPage, /sessionStartMs \+ \(90 \* 60 \* 1000\)/);
assert.match(confirmationPage, /MC2_SESSION_DURATION_MS as SESSION_DURATION_MS/);
assert.doesNotMatch(confirmationPage, /75 \* 60 \* 1000/);
assert.match(getRegistration, /mc2SessionEndsAtIso\(row\.session_starts_at\)/);
assert.match(eligibility, /mc2SessionEndsAtIso\(row\.session_starts_at\)/);

console.log(JSON.stringify({
  canonical_live_end_015908_after_session_start: 'ok',
  stale_75_minute_end_ignored_by_live_page: 'ok',
  existing_registration_contract_normalized: 'ok',
  live_replay_cta_alignment: 'ok',
}, null, 2));
