import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/pages/mc2/confirmation.astro', import.meta.url), 'utf8');
const link = source.match(/<a id="join-button"[^>]*>/)?.[0];
assert.match(link, /target="_blank"/);
assert.match(link, /rel="noopener noreferrer"/);
const sessionUrl = source.match(/            function sessionUrl\(session\) \{[^]*?\n            \}/)?.[0];
assert.ok(sessionUrl);
for (const preview of [false, true]) {
  const context = {
    URLSearchParams, window: { location: { search: preview ? '?preview=dev' : '' } },
    readToken: () => '00000000-0000-4000-8000-000000000001',
    session: { startsAt: '2026-09-27T20:00:00Z', id: 'fixed-1', kind: 'scheduled' },
  };
  const url = new URL(runInNewContext(sessionUrl + '\nsessionUrl(session)', context), 'https://example.invalid');
  assert.equal(url.pathname, '/mc2/session/');
  assert.equal(url.searchParams.get('t'), context.readToken());
  if (preview) assert.equal(url.searchParams.get('preview'), 'mc2');
}
assert.match(source, /if \(event.currentTarget.classList.contains\('is-locked'\)\) event.preventDefault\(\);/);
assert.match(source, /else trackMc2Event\('room_join_clicked'/);
console.log('PASS: new tab with noopener/noreferrer, unique token and preview parameters preserved, expired-session guard and click tracking retained.');
