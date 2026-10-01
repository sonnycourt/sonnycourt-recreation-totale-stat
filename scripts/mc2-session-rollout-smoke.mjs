import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as timing from '../src/lib/mc2-timing.mjs';
import * as media from '../src/lib/mc2-media.mjs';
import videoConfig from '../netlify/functions/mc2-video-config.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
for (const page of ['session', 'replay']) {
  const source = read(`src/pages/mc2/${page}.astro`);
  assert.ok(source.includes('DealOfferDraftX.astro'), page + ': new offer');
  assert.ok(source.includes('<DraftXSandbox production bunnyPlayer />'), page + ': production sandbox with scoped official-player permissions');
  assert.ok(source.includes('<Mc2Tracking />'));
  assert.ok(source.includes('mc2-media.mjs'));
  assert.ok(source.includes('mc2-timing.mjs'));
  assert.ok(!source.includes('/mc2/draftx/'), page + ': canonical customer links');
  const archive = read(`src/pages/mc2/${page}-archive.astro`);
  assert.ok(archive.includes('mc2-legacy-timing.mjs'));
  assert.ok(archive.includes('noindex, nofollow, noarchive'));
  assert.ok(archive.includes('DealOffer.astro'));
}
assert.ok(read('src/pages/mc2/replay.astro').includes('mc2_replay_recovery_access'));
const livePage = read('src/pages/mc2/session.astro');
const liveVideo = livePage.match(/<video\b[^>]*id="masterclass-video"[^>]*>/)?.[0] || '';
assert.match(liveVideo, /\bdisablepictureinpicture(?:\s|>)/, 'Live video requests no detached PiP controls; browser preferences may override it');
assert.match(livePage, /id="fullscreenBtnDesktop"/, 'Keep the custom fullscreen button');
assert.ok(livePage.includes('videoContainer.requestFullscreen()'), 'Fullscreen still targets the container with our controls');
const replayPage = read('src/pages/mc2/replay.astro');
const replayVideo = replayPage.match(/<video\b[^>]*id="replay-video"[^>]*>/)?.[0] || '';
assert.match(replayVideo, /\bdisablepictureinpicture(?:\s|>)/, 'Replay video requests no detached PiP controls; browser preferences may override it');
assert.match(replayPage, /id="fullscreen-btn"/, 'Keep the replay custom fullscreen button');
assert.ok(replayPage.includes('box.requestFullscreen?.()'), 'Replay fullscreen still targets the container with our controls');
const headers = read('public/_headers');
for (const page of ['session', 'replay']) {
  for (const suffix of ['', '/', '/index.html']) {
    const route = '/mc2/' + page + suffix;
    assert.ok(headers.includes(route + '\n  Permissions-Policy: picture-in-picture=()'), 'Deny the PiP API on ' + route);
  }
}
assert.equal(timing.MC2_LIVE_CTA_SECONDS, 5732);
assert.equal(timing.MC2_REPLAY_CTA_SECONDS, 4532);
assert.equal(media.MC2_DRAFTX_REPLAY_PATH, '/mc2/replay/');
assert.equal(media.MC2_DRAFTX_REPLAY_ENTRY, '/.netlify/functions/mc2-replay-enter?t=');
const config = await (await videoConfig(new Request('https://example.invalid/.netlify/functions/mc2-video-config?variant=w14'))).json();
assert.equal(config.variant, 'w14');
assert.equal(config.activeUrl, media.MC2_DRAFTX_LIVE_HLS_URL);
assert.equal(config.forceRefreshAt, null);
const priorConfig = await (await videoConfig(new Request('https://example.invalid/.netlify/functions/mc2-video-config?variant=w13b'))).json();
assert.match(priorConfig.activeUrl, /c0135d6e-9cfe-4605-a90b-b2ea2d7d7961/);
assert.equal(priorConfig.forceRefreshAt, null, 'Do not force-switch an already-open W13B player');
const redirects = read('public/_redirects');
assert.match(redirects, /\/mc2\/draftx\/\s+\/mc2\/session\/\s+301!/);
assert.match(redirects, /\/mc2\/draftx\/replay\/\s+\/mc2\/replay\/\s+301!/);
assert.ok(read('src/pages/mc2/confirmation.astro').includes('/mc2/session/'));
assert.ok(read('netlify/functions/register-mc2.js').includes('/mc2/confirmation'));
const sandbox = read('src/components/mc2/DraftXSandbox.astro');
assert.ok(sandbox.includes('Content-Security-Policy'));
assert.ok(sandbox.includes("object-src 'none'"));
assert.ok(sandbox.includes("form-action 'none'"));
console.log('PASS — canonical funnel, new offer, W14 timings, existing tokens, no forced reload, archives and security policy retained.');
