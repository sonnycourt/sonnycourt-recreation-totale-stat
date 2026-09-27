import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MC2_LIVE_CTA_SECONDS, MC2_REPLAY_CTA_SECONDS } from '../src/lib/mc2-timing.mjs';

for (const [route, name, cta] of [['session', 'updateCtaStateByTime', MC2_LIVE_CTA_SECONDS], ['replay', 'updateCtaStateByVideoTime', MC2_REPLAY_CTA_SECONDS]]) {
  const source = readFileSync(new URL('../src/pages/mc2/' + route + '.astro', import.meta.url), 'utf8');
  const indent = route === 'session' ? '            ' : '      ';
  const fn = source.match(new RegExp(indent + 'function ' + name + '\\(\\) \\{[^]*?\\n' + indent + '\\}'))?.[0];
  assert.ok(fn);
  for (const seconds of [0, 1200, cta - 1, cta - 0.01, cta, cta + 1]) {
    let available = false, shown = false;
    const context = {
      forceLateOverlay: false, forceEndedOverlay: false, isSessionEnded: false,
      liveStartMs: 0, getNowMs: () => seconds * 1000,
      CTA_APPEAR_SECONDS: cta, CTA_ACTIVATE_SECONDS: cta,
      reg: { token: 'fixture-only' }, didTrackCtaReached: true,
      expiryMs: 999999999, ctaActivationMs: cta * 1000,
      showOfferZone() { shown = true; }, hideOfferZone() { shown = false; },
      syncDealCountdown() {}, setOfferCtaEnabled(v) { available = v; }, setOfferHeroVisible() {},
      video: { currentTime: seconds }, isOfferExpiredNow: () => false,
      setOfferExpiredState() {},
      activateOfferAndScarcity() { available = shown = true; },
      hideOfferAndScarcity() { available = shown = false; },
      showLockedOffer() { shown = true; },
    };
    runInNewContext(fn + '\n' + name + '();', context);
    assert.equal(available, seconds >= cta, route + ' checkout at ' + seconds);
    assert.equal(shown, seconds >= cta, route + ' offer at ' + seconds);
  }
}
const confirmation = readFileSync(new URL('../src/pages/mc2/confirmation.astro', import.meta.url), 'utf8');
assert.doesNotMatch(confirmation, /<DealOffer|<DraftXCheckout/);
console.log('PASS: canonical live/replay offer hidden before CTA, available at exact CTA; no offer on confirmation.');
