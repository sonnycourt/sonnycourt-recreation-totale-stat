import assert from 'node:assert/strict';
import { createPremiumExpiry } from '../src/lib/es2-premium-expiry.mjs';
const control = tagName => ({ tagName, disabled: false, attrs: { href: 'https://sonnycourt.spiffy.co/checkout/offre-delta-es2?locale=fr' }, setAttribute(k,v) { this.attrs[k]=v; }, getAttribute(k) { return this.attrs[k]; }, removeAttribute(k) { delete this.attrs[k]; } });
const controls = [control('BUTTON'), control('A')];
const tasks = new Map();
const navigations = [];
let next = 0, closed = 0, checkoutClosed = 0;
const status = { hidden: true, textContent: '' };
const doc = {
  documentElement: { dataset: {} },
  querySelectorAll(selector) { return selector === '[data-premium-plan]' ? controls : [{ close() { closed++; } }]; },
  querySelector(selector) { return selector.includes('spiffy-checkout-modal') ? { click() { checkoutClosed++; } } : { getAttribute() { return '/delta-vision/merci/'; } }; },
  getElementById() { return status; },
};
const expiry = createPremiumExpiry({ document: doc, navigate: url => navigations.push(url), schedule(fn) { tasks.set(++next,fn);return next; }, cancel(id) { tasks.delete(id); } });
expiry.expire(); expiry.expire();
assert.equal(tasks.size,1);
assert.equal(closed,1); assert.equal(checkoutClosed,1);
assert.equal(controls[0].disabled,true);
assert.equal(controls[1].getAttribute('href'),undefined);
assert.equal(doc.documentElement.dataset.premiumExpired,'true');
assert.equal(status.hidden,false);
expiry.reset();
assert.equal(tasks.size,0);
assert.equal(controls[0].disabled,false);
assert.match(controls[1].getAttribute('href'),/locale=fr/);
assert.equal(status.hidden,true);
expiry.expire();
[...tasks.values()][0]();
assert.deepEqual(navigations,['/delta-vision/merci/']);
console.log('Expiry: disable, close, single decline navigation and dev reset verified.');
