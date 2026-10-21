import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const page = readFileSync(new URL('../src/pages/es2-offre-premium.astro', import.meta.url), 'utf8');
assert(page.indexOf('<script is:inline src="https://assets.mediadelivery.net/playerjs/') < page.indexOf('<iframe'));
const start = page.indexOf('const connectVideo = () => {');
const end = page.indexOf('if (bunnyWindow.playerjs?.Player) connectVideo();', start);
const source = ts.transpileModule(page.slice(start, end) + '\nconnectVideo();', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const events = {};
  const saved = new Map();
  let renders = 0;
  const context = {
    frame: {}, videoPlayer: undefined, videoOfferReached: false,
    countdownDeadline: 123456, videoRevealKey: 'reveal',
    localStorage: { setItem: (key, value) => saved.set(key, value) },
    renderCountdown: () => renders++,
    bunnyWindow: { playerjs: { Player: class {
      on(name, callback) { events[name] = callback; }
      getCurrentTime(callback) { callback(170); }
    } } },
  };
  vm.runInNewContext(source, context);
  return { context, events, saved, renders: () => renders };
}

for (const encode of [value => value, JSON.stringify]) {
  const test = setup();
  assert.equal(typeof test.events.timeupdate, 'function', 'Subscribe without waiting for ready');
  for (const value of [undefined, null, {}, { seconds: NaN }, { seconds: Infinity }, { seconds: 163.99 }]) {
    test.events.timeupdate(encode(value));
    assert.equal(test.renders(), 0);
  }
  test.events.timeupdate(encode({ seconds: 164 }));
  assert.equal(test.renders(), 1);
  assert.equal(test.saved.get('reveal'), '123456');
  test.events.timeupdate(encode({ seconds: 180 }));
  assert.equal(test.renders(), 1, 'Reveal is idempotent');
}
const resumed = setup();
resumed.events.ready();
assert.equal(resumed.renders(), 1, 'Already advanced playback is checked on ready');
console.log('Video reveal: early subscription, numeric/object/JSON payloads, 164s threshold, persistence and idempotence verified.');
