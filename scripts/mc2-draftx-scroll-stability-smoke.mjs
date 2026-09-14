import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/pages/mc2/draftx.astro', import.meta.url), 'utf8');
const activate = source.match(/function activateLiveJoinState\(\) \{[\s\S]*?\n            \}(?=\n\n            function refreshPreLiveCountdown)/)?.[0];
assert.ok(activate, 'Live-state transition must be present');

let resets = 0;
let updates = 0;
const classList = { add() {}, remove() {} };
const context = vm.createContext({
  isSessionEnded: false,
  liveStarted: false,
  endedNote: { classList },
  preLive: { style: {} },
  video: { paused: false },
  waiting: { classList, querySelector: () => ({ textContent: '', classList }) },
  playOverlay: { classList },
  setReturningBuyerUi(on) {
    assert.equal(on, false);
    resets += 1;
  },
  applySimulatedLiveOffset() { updates += 1; },
  syncIcons() {},
});
vm.runInContext(activate, context);
for (let tick = 0; tick < 120; tick += 1) {
  context.activateLiveJoinState();
}
assert.equal(resets, 1, 'Repeated live ticks must not empty the offer hero');
assert.equal(updates, 120, 'Normal live updates must continue');

context.video.paused = true;
context.activateLiveJoinState();
assert.equal(resets, 1, 'Waiting for playback must not reset the offer hero');
context.isSessionEnded = true;
context.activateLiveJoinState();
assert.equal(updates, 121, 'An ended session must not reactivate');
context.isSessionEnded = false;
context.liveStarted = false;
context.activateLiveJoinState();
assert.equal(resets, 2, 'A real transition back to live still resets the ended layout');

console.log('PASS — live ticks preserve the offer hero; real state transitions still work.');
