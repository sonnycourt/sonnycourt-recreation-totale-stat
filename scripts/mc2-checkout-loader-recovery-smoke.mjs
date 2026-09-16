import assert from 'node:assert/strict';
import { mountDraftXSpiffy, SPIFFY_ORIGIN } from '../src/lib/mc2-draftx-spiffy.mjs';
import { DRAFTX_PAYMENT_PLANS } from '../src/lib/mc2-draftx-checkout.mjs';

function fixture(plan, { brokenTracking = false } = {}) {
  let now = 0, nextId = 0, listener;
  const timers = new Map(), events = [];
  const node = tag => ({
    tag, style: {}, attributes: {}, children: [], contentWindow: {}, removed: false,
    set textContent(text) { this.text = text; this.children = []; },
    get textContent() { return this.text || ''; },
    set src(value) { this.source = value; this.navigations = (this.navigations || 0) + 1; },
    get src() { return this.source; },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(child) { this.children.push(child); },
    remove() { this.removed = true; },
    addEventListener(name, fn) { this[name] = fn; },
  });
  const view = {
    location: { href: 'https://sonnycourt.com/mc2/session/', assign() { throw Error('No purchase/navigation in these tests'); } },
    addEventListener(name, fn) { listener = fn; }, removeEventListener() { listener = null; },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const slot = { dataset: {}, attributes: {}, ownerDocument: { defaultView: view, createElement: node, createTextNode: text => ({ text }) },
    setAttribute(key, value) { this.attributes[key] = value; }, replaceChildren(...children) { this.children = children; } };
  const originalNow = Date.now;
  Date.now = () => now;
  const handle = mountDraftXSpiffy(slot, plan, { firstName: 'Test', email: 'test@example.invalid', registrationToken: 'mc2-unit-only-1234567890' }, {
    track(name, meta) { if (brokenTracking) throw Error('analytics offline'); events.push({ name, ...meta }); },
  });
  const [status, frame] = slot.children;
  return { slot, status, frame, events, handle,
    message(data, origin = SPIFFY_ORIGIN, source = frame.contentWindow) { listener?.({ data, origin, source }); },
    tick(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = target;
    },
    cleanup() { handle.destroy(); Date.now = originalNow; },
  };
}

for (const plan of Object.values(DRAFTX_PAYMENT_PLANS)) {
  // Normal provider handshake keeps the same short anti-flash treatment.
  let f = fixture(plan);
  f.frame.onload();
  f.message({ type: 'mc2:draftx-spiffy-ready', identityReady: true });
  f.message({ type: 'mc2:draftx-spiffy-height', height: 310 });
  f.tick(699); assert.equal(f.frame.style.opacity, '0');
  f.tick(1); assert.equal(f.frame.style.opacity, '1');
  assert.equal(f.frame.style.height, '310px'); assert.equal(f.status.removed, true);
  f.tick(30000); assert.equal(f.events.filter(e => e.name === 'payment_frame_visible').length, 1);
  assert.ok(!f.events.some(e => e.name === 'payment_frame_timeout'));
  f.cleanup();

  // Firefox/slow bootstrap: loaded iframe, no custom signals, or just one.
  for (const signal of [null, { type: 'mc2:draftx-spiffy-ready', identityReady: true }, { event: 'form:size', data: { height: 350 } }]) {
    f = fixture(plan); f.frame.onload(); if (signal) f.message(signal);
    f.tick(2999); assert.equal(f.frame.style.opacity, '0');
    f.tick(1); assert.equal(f.frame.style.opacity, '1');
    assert.equal(f.frame.attributes['aria-hidden'], 'false');
    assert.equal(f.frame.style.pointerEvents, 'auto');
    assert.equal(f.slot.attributes['aria-busy'], 'false');
    assert.equal(f.events.find(e => e.name === 'payment_frame_visible').frame_evidence, 'iframe_load_fallback');
    assert.ok(!f.status.children.some(n => n.tag === 'a'), 'No external link on first failure');
    f.tick(30000); assert.equal(f.frame.navigations, 1, 'No automatic retry');
    f.status.children.find(n => n.tag === 'button').click();
    assert.equal(f.frame.navigations, 2);
    assert.equal(f.frame.style.opacity, '0');
    assert.ok(!f.status.children.some(n => n.tag === 'a'), 'No link while retry is loading');
    f.frame.onload(); f.tick(3000);
    const link = f.status.children.find(n => n.tag === 'a');
    const url = new URL(link.href);
    assert.equal(url.origin, SPIFFY_ORIGIN); assert.equal(url.pathname, new URL(plan.checkoutUrl).pathname);
    assert.equal(url.searchParams.get('mc2_token'), 'mc2-unit-only-1234567890');
    assert.equal(url.searchParams.get('email'), 'test@example.invalid');
    for (const key of ['elements', 'mc2_draftx', 'mc2_parent_origin']) assert.equal(url.searchParams.has(key), false);
    assert.equal(link.rel, 'noopener noreferrer');
    f.message({ type: 'mc2:draftx-spiffy-height', height: 470 });
    assert.equal(f.frame.style.height, '470px', 'Late resize remains functional');
    f.cleanup();
  }

  // Fully blocked iframe never falsely reports ready, but offers a real exit.
  f = fixture(plan); f.tick(20000);
  assert.equal(f.frame.style.opacity, '0');
  assert.ok(!f.status.children.some(n => n.tag === 'a'));
  assert.ok(f.events.some(e => e.name === 'payment_frame_timeout'));
  const retry = f.status.children.find(n => n.tag === 'button'); retry.click();
  f.tick(19999); assert.ok(!f.status.children.some(n => n.tag === 'a'));
  f.tick(1); assert.ok(f.status.children.some(n => n.tag === 'a'), 'External link after second timeout only');
  assert.equal(f.frame.navigations, 2);
  f.frame.onload(); f.tick(3000); assert.equal(f.frame.style.opacity, '1'); f.cleanup();

  // A late ready signal removes recovery controls without losing card inputs.
  f = fixture(plan); f.frame.onload(); f.tick(3000);
  const staleRetry = f.status.children.find(n => n.tag === 'button');
  f.message({ type: 'mc2:draftx-spiffy-ready', identityReady: true });
  f.message({ type: 'mc2:draftx-spiffy-height', height: 310 });
  assert.equal(f.status.removed, true);
  staleRetry.click(); assert.equal(f.frame.navigations, 1); f.cleanup();

  // A successful manual retry never shows the external escape link.
  f = fixture(plan); f.tick(20000); f.status.children.find(n => n.tag === 'button').click();
  f.frame.onload();
  f.message({ type: 'mc2:draftx-spiffy-ready', identityReady: true });
  f.message({ type: 'mc2:draftx-spiffy-height', height: 310 });
  f.tick(3000); assert.equal(f.status.removed, true);
  assert.ok(!f.status.children.some(n => n.tag === 'a')); f.cleanup();

  // Foreign signals cannot reveal the iframe; closing cancels all timers.
  f = fixture(plan);
  f.message({ type: 'mc2:draftx-spiffy-ready' }, 'https://evil.invalid');
  f.message({ type: 'mc2:draftx-spiffy-height', height: 310 }, SPIFFY_ORIGIN, {});
  f.tick(1000); assert.equal(f.frame.style.opacity, '0');
  f.frame.onload(); f.handle.destroy(); f.tick(30000);
  assert.equal(f.frame.style.opacity, '0'); assert.equal(f.slot.children.length, 0); f.cleanup();

  // Analytics failures cannot prevent access to either payment plan.
  f = fixture(plan, { brokenTracking: true }); f.frame.onload(); f.tick(3000);
  assert.equal(f.frame.style.opacity, '1'); f.cleanup();
}
console.log('PASS — both plans: normal, missing/late bridge, blocked iframe, retry, cleanup, tracking failure, safe standalone URL. No payment.');
