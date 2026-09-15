import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { mc2ReplayExpiresAt } from '../src/lib/mc2-timing.mjs';

const page = readFileSync(new URL('../src/pages/mc2/replay.astro', import.meta.url), 'utf8');
function source(name) {
  const match = page.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    \\}`));
  assert.ok(match, name);
  return match[0];
}
assert.ok(!page.includes("Replay disponible jusqu'à dimanche 23h"));
assert.match(page, /<p id="replay-access-deadline" hidden><\/p>/, 'No false deadline flashes before access validation');
assert.match(page, /function mountReplay\(reg, token\)\s*\{\s*syncReplayAccessDeadline\(reg.accessExpiresAt\)/);

const label = { textContent: '', hidden: true };
const ctx = { document: { getElementById: () => label }, Intl, Date,
  mc2ReplayExpiresAt, URLSearchParams, window: { location: { search: '' } },
  VIDEO_SOURCE_URL_PRIMARY: 'https://example.invalid/video',
};
runInNewContext([source('syncReplayAccessDeadline'), source('validateAccessWithToken'),
  source('createPreviewRegistration')].join('\n'), ctx);
ctx.syncReplayAccessDeadline('2026-09-18T14:35:00Z');
assert.equal(label.hidden, false);
assert.equal(label.textContent, 'Replay disponible jusqu’au vendredi 18 septembre à 16:35 (heure de Paris).');
ctx.syncReplayAccessDeadline('2026-12-18T14:35:00Z');
assert.match(label.textContent, /vendredi 18 décembre à 15:35/, 'Paris winter time is correctly applied');
for (const missing of [null, undefined, '', 'not-a-date']) {
  ctx.syncReplayAccessDeadline(missing);
  assert.equal(label.hidden, true, 'Missing date never invents an expiry');
  assert.equal(label.textContent, '');
}

for (const expiresAt of ['2026-09-18T14:35:00Z', '2026-09-20T19:15:00Z']) {
  ctx.fetch = async () => ({ ok: true, json: async () => ({ valid: true,
    registrationToken: 'unit-only', expiresAt, offerExpiresAt: '2026-09-30T00:00:00Z' }) });
  const reg = await ctx.validateAccessWithToken('unit-only-access');
  assert.equal(reg.accessExpiresAt, expiresAt, 'Each access retains the server deadline, not the offer deadline');
  ctx.syncReplayAccessDeadline(reg.accessExpiresAt);
  assert.equal(label.hidden, false);
}
const preview = ctx.createPreviewRegistration();
assert.equal(preview.accessExpiresAt, mc2ReplayExpiresAt(preview.sessionStartsAt).toISOString(),
  'Preview uses the existing 72-hour session rule without changing production access logic');
console.log('PASS — personalized server expiry, Paris summer/winter time, no false fallback, preview, and no network writes.');
