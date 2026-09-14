import assert from 'node:assert/strict';
import { mountDraftXSpiffy, SPIFFY_ORIGIN } from '../src/lib/mc2-draftx-spiffy.mjs';
import { DRAFTX_PAYMENT_PLANS } from '../src/lib/mc2-draftx-checkout.mjs';

const originalNow = Date.now;
let now = 0;
Date.now = () => now;
function fixture(plan) {
  let listener, id = 0;
  const timers = new Map();
  const view = {
    location: { href: 'https://sonnycourt.com/mc2/session/', assign() {} },
    addEventListener: (_, fn) => { listener = fn; }, removeEventListener() {},
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout: key => timers.delete(key),
  };
  const node = () => ({ style: {}, attributes: {}, contentWindow: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = value; },
    remove() { this.removed = true; }, append(child) { this.children.push(child); },
    addEventListener(_, fn) { this.click = fn; },
  });
  const slot = { ...node(), dataset: {}, ownerDocument: { defaultView: view, createElement: node },
    replaceChildren(...children) { this.children = children; },
  };
  const handle = mountDraftXSpiffy(slot, plan, { firstName: 'Test', email: 'test@example.invalid' });
  const [status, frame] = slot.children;
  const send = data => listener({ origin: SPIFFY_ORIGIN, source: frame.contentWindow, data });
  const tick = ms => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  };
  return { slot, status, frame, send, tick, handle, timers };
}
try {
  for (const plan of Object.values(DRAFTX_PAYMENT_PLANS)) {
    const f = fixture(plan);
    assert.equal(f.frame.style.opacity, '0');
    f.send({ event: 'form:size', data: { height: 1200 } });
    assert.equal(f.frame.style.height, '320px', 'Startup resizes do not move the popup');
    f.send({ type: 'mc2:draftx-spiffy-ready', identityReady: true });
    f.send({ type: 'mc2:draftx-spiffy-height', height: 310 });
    f.tick(699); assert.equal(f.frame.style.opacity, '0');
    f.tick(1); assert.equal(f.frame.style.opacity, '1');
    assert.equal(f.frame.style.height, '310px');
    assert.equal(f.slot.attributes['aria-busy'], 'false');
    assert.equal(f.slot.dataset.identityTransmitted, 'true');
    assert.ok(f.status.removed);
    f.send({ type: 'mc2:draftx-spiffy-height', height: 650 });
    assert.equal(f.frame.style.height, '650px', 'Errors and 3DS can still resize the frame');
    f.handle.destroy(); assert.equal(f.timers.size, 0);
  }
  const pending = fixture(DRAFTX_PAYMENT_PLANS.twelve);
  pending.send({ type: 'mc2:draftx-spiffy-ready', identityReady: true });
  pending.tick(1000); assert.equal(pending.frame.style.opacity, '0', 'Wait for a measured height');
  pending.tick(19000); assert.ok(pending.status.textContent.includes('plus de temps'));
  pending.status.children[0].click();
  assert.equal(pending.slot.attributes['aria-busy'], 'true');
  pending.send({ type: 'mc2:draftx-spiffy-height', height: 300 });
  pending.send({ type: 'mc2:draftx-spiffy-ready', identityReady: true });
  pending.handle.destroy(); pending.tick(20000);
  assert.equal(pending.frame.style.opacity, '0', 'A destroyed checkout cannot reveal later');
  assert.equal(pending.timers.size, 0);
  console.log('PASS — stable loader, two plans, ready + height, delayed reveal, dynamic resize, retry and cleanup. No service called.');
} finally { Date.now = originalNow; }
