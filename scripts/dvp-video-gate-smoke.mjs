import assert from 'node:assert/strict';
import {secondsUntilDvpOffer as remaining,formatDvpCountdown as fmt} from '../src/lib/dvp-video-gate.mjs';
assert.equal(remaining(0,720),660);
assert.equal(remaining(659.3,720),1);
assert.equal(remaining(660,720),0);
assert.equal(remaining(720,720),0);
assert.equal(remaining(100,720),560); // Pausing does not advance the timer.
assert.equal(remaining(50,720),610); // Seeking back follows the player.
assert.equal(remaining(659,780),61); // Uses actual duration, not fixed "12 minutes".
assert.equal(remaining(0,0),null);
assert.equal(remaining(NaN,720),null);
assert.equal(fmt(61),'01:01');
console.log('DVP player gate: 10 checks passed');
