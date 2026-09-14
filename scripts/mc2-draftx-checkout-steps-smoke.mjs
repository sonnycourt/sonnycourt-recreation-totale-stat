import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DRAFTX_PAYMENT_PLANS, initDraftXCheckout } from '../src/lib/mc2-draftx-checkout.mjs';

// Unit tests of the controller: no browser, provider, request or real customer.
class ElementStub extends EventTarget {
  dataset = {};
  attributes = new Map();
  classes = new Set();
  classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  value = '';
  textContent = '';
  checked = false;
  hidden = false;
  disabled = false;
  inert = false;
  open = false;
  modalOpenCount = 0;
  scrollTop = 0;
  animations = [];
  nodes = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(name) { return this.nodes.get(name) || null; }
  querySelectorAll(name) { return this.nodes.get(name) || []; }
  focus(options) { this.focused = true; this.focusOptions = options; }
  scrollIntoView() { assert.fail('Changing a step must not move the page'); }
  getBoundingClientRect() { return { left: 100, top: 50, right: 860, bottom: 810 }; }
  showModal() { this.open = true; this.modalOpenCount += 1; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Event('close')); }
  animate(keyframes, options) {
    let resolve, reject;
    const animation = {
      keyframes, options,
      finished: new Promise((done, fail) => { resolve = done; reject = fail; }),
      finish: () => resolve(),
      cancel() { this.cancelled = true; reject(new Error('Cancelled')); },
    };
    this.animations.push(animation);
    return animation;
  }
  reportValidity() { return this.validityCheck?.() ?? true; }
  get validity() { return { valid: this.validityCheck?.() ?? true }; }
  click() { this.dispatchEvent(new Event('click')); }
}

function fixture({ reducedMotion = false, animate = true, mobile = false, preview = true } = {}) {
  const root = new ElementStub();
  const view = new EventTarget();
  if (preview) view.__mc2DraftX = {};
  const mobileQuery = new EventTarget();
  mobileQuery.matches = mobile;
  view.matchMedia = query => query === '(max-width: 600px)' ? mobileQuery : { matches: reducedMotion };
  root.ownerDocument = { defaultView: view };
  const form = new ElementStub();
  const dialog = new ElementStub();
  const openButton = new ElementStub();
  const closeButton = new ElementStub();
  root.ownerDocument.activeElement = openButton;
  root.nodes.set('#draftx-checkout-dialog', dialog);
  root.nodes.set('[data-checkout-open]', openButton);
  root.nodes.set('[data-checkout-close]', closeButton);
  const panels = [1, 2, 3].map(step => {
    const panel = new ElementStub();
    panel.dataset.checkoutStep = String(step);
    panel.nodes.set('h3', new ElementStub());
    if (!animate) panel.animate = undefined;
    return panel;
  });
  const plans = ['six', 'twelve'].map(plan => {
    const button = new ElementStub();
    button.dataset.paymentPlan = plan;
    return button;
  });
  const planList = {
    children: [...plans],
    get firstElementChild() { return this.children[0]; },
    prepend(node) { this.children = [node, ...this.children.filter(child => child !== node)]; },
  };
  plans.forEach(button => { button.parentElement = planList; });
  const backs = [new ElementStub(), new ElementStub()];
  root.nodes.set('form', form);
  root.nodes.set('[data-checkout-step]', panels);
  root.nodes.set('[data-payment-plan]', plans);
  root.nodes.set('[data-checkout-back]', backs);
  for (const selector of ['#draftx-first-name', '#draftx-email', '[data-identity-check="firstName"]', '[data-identity-check="email"]', '[data-spiffy-slot]', '#draftx-payment-status', '[data-payment-schedule]', '[data-payment-commitment]']) root.nodes.set(selector, new ElementStub());
  const name = root.querySelector('#draftx-first-name');
  const email = root.querySelector('#draftx-email');
  const status = root.querySelector('#draftx-payment-status');
  name.validityCheck = () => name.value.length > 0;
  email.validityCheck = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value);
  const mounts = [];
  const mountPayment = (slot, plan, identity) => {
    const instance = { slot, plan, identity, destroyed: false, destroy() { this.destroyed = true; } };
    mounts.push(instance);
    return instance;
  };
  const submit = () => {
    const event = new Event('submit', { cancelable: true });
    form.dispatchEvent(event);
    assert.ok(event.defaultPrevented, 'No native form submission');
  };
  initDraftXCheckout(root, { mountPayment });
  return { root, form, panels, plans, planList, mobileQuery, backs, name, email, mounts, status, submit, view, dialog, openButton, closeButton };
}

const mobileCheckout = fixture({ mobile: true });
assert.deepEqual(mobileCheckout.planList.children.map(button => button.dataset.paymentPlan), ['twelve', 'six'], 'Mobile DOM and keyboard order put the popular plan first');
mobileCheckout.openButton.click();
mobileCheckout.name.value = 'Test';
mobileCheckout.email.value = 'test@example.invalid';
mobileCheckout.submit();
mobileCheckout.plans[0].click();
mobileCheckout.mobileQuery.matches = false;
mobileCheckout.mobileQuery.dispatchEvent(new Event('change'));
assert.deepEqual(mobileCheckout.planList.children.map(button => button.dataset.paymentPlan), ['six', 'twelve'], 'Desktop order is restored at the breakpoint');
assert.equal(mobileCheckout.plans[0].attributes.get('aria-pressed'), 'true', 'Resizing preserves the selected plan');
assert.equal(mobileCheckout.root.dataset.step, '2');
assert.equal(mobileCheckout.mounts.length, 0, 'Reordering cannot initiate payment');
mobileCheckout.mobileQuery.matches = true;
mobileCheckout.mobileQuery.dispatchEvent(new Event('change'));
assert.equal(mobileCheckout.planList.firstElementChild.dataset.paymentPlan, 'twelve');
mobileCheckout.submit();
assert.equal(mobileCheckout.mounts[0].plan, DRAFTX_PAYMENT_PLANS.six, 'Visual reordering does not change the confirmed checkout');

const f = fixture();
function expectStep(step) {
  assert.equal(f.root.dataset.step, String(step));
  assert.deepEqual(f.panels.map(panel => panel.hidden), [1, 2, 3].map(i => i !== step));
  assert.deepEqual(f.panels.map(panel => panel.disabled), [1, 2, 3].map(i => i !== step));
  assert.deepEqual(f.panels.map(panel => panel.inert), [1, 2, 3].map(i => i !== step));
  assert.deepEqual(f.panels.map(panel => panel.attributes.get('aria-hidden')), [1, 2, 3].map(i => String(i !== step)));
}
expectStep(1);
assert.equal(f.dialog.open, false, 'The form is initially behind the launch button');
f.openButton.click();
assert.equal(f.dialog.open, true);
f.openButton.click();
assert.equal(f.dialog.modalOpenCount, 1, 'Opening twice does not create another dialog');
assert.equal(f.panels[0].animations.length, 0, 'No animation or forced scroll on initial load');
f.submit();
expectStep(1); // Blank fields cannot advance.
f.name.value = '   ';
f.email.value = 'test@example.invalid';
f.submit();
expectStep(1);
f.name.value = ' Preview ';
f.email.value = 'not-an-email';
f.submit();
expectStep(1);
f.email.value = ' preview@example.invalid ';
initDraftXCheckout(f.root); // Idempotent: must not add a second submit listener.
f.submit();
expectStep(2);
assert.equal(f.panels[1].animations[0].keyframes[0].transform, 'translateX(-64px)', 'Forward enters from the left');
assert.equal(f.name.value, 'Preview');
assert.equal(f.email.value, 'preview@example.invalid');
assert.ok(f.panels[1].querySelector('h3').focused);
assert.equal(f.panels[1].querySelector('h3').focusOptions.preventScroll, true);
assert.equal(f.plans[1].attributes.get('aria-pressed'), 'true');
f.plans[0].click();
expectStep(2); // Choosing a plan is distinct from confirming it.
assert.equal(f.plans[0].attributes.get('aria-pressed'), 'true');
assert.equal(f.plans[1].attributes.get('aria-pressed'), 'false');
f.submit();
expectStep(3);
assert.equal(f.root.querySelector('[data-payment-schedule]').textContent, 'Puis 347 €/mois sur 6 mois.');
assert.equal(f.root.querySelector('[data-payment-commitment]').textContent, 'Aucun montant prélevé aujourd’hui.');
f.submit();
assert.equal(f.status.textContent, ''); // Only Spiffy can submit a payment.
assert.equal(f.mounts.length, 1);
assert.equal(f.mounts[0].plan.checkoutUrl, DRAFTX_PAYMENT_PLANS.six.checkoutUrl);
assert.deepEqual(f.mounts[0].identity, { firstName: 'Preview', email: 'preview@example.invalid' });
f.backs[1].click();
expectStep(2);
assert.equal(f.panels[1].animations.at(-1).keyframes[0].transform, 'translateX(64px)', 'Back reverses the slide');
assert.equal(f.panels[2].animations[0].cancelled, true);
f.plans[1].click();
assert.equal(f.mounts[0].destroyed, true, 'A plan change removes the old payment frame and its consent state');
f.backs[0].click();
expectStep(1);
assert.equal(f.name.value, 'Preview');
assert.equal(f.email.value, 'preview@example.invalid');
f.submit();
expectStep(2);
f.submit();
expectStep(3);
assert.equal(f.root.querySelector('[data-payment-schedule]').textContent, 'Puis 197 €/mois sur une année.');
assert.equal(f.status.textContent, '');
assert.equal(f.mounts.length, 2);
assert.equal(f.mounts[1].plan.checkoutUrl, DRAFTX_PAYMENT_PLANS.twelve.checkoutUrl);
f.plans[0].click(); // Hidden plan controls cannot change the confirmed schedule.
assert.match(f.root.querySelector('[data-payment-schedule]').textContent, /197 €/);
assert.equal(f.mounts.length, 2, 'Reopening does not mount another payment form');

// Closing and reopening retains the plan, identity and current panel.
f.closeButton.click();
assert.equal(f.dialog.open, false);
assert.equal(f.openButton.focusOptions.preventScroll, true);
f.submit();
f.backs[1].click();
expectStep(3); // Closed dialog controls cannot advance or go back.
f.openButton.click();
expectStep(3);
assert.equal(f.name.value, 'Preview');
assert.equal(f.email.value, 'preview@example.invalid');
assert.match(f.root.querySelector('[data-payment-schedule]').textContent, /197 €/);

const pointerEvent = (target, type, x, y) => {
  const event = new Event(type);
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } });
  target.dispatchEvent(event);
};
pointerEvent(f.dialog, 'pointerdown', 120, 70);
pointerEvent(f.dialog, 'click', 120, 70);
assert.equal(f.dialog.open, true, 'Clicking inside the dialog does not close it');
pointerEvent(f.dialog, 'pointerdown', 120, 70);
pointerEvent(f.dialog, 'click', 10, 10);
assert.equal(f.dialog.open, true, 'Dragging from inside to the backdrop does not close it');
pointerEvent(f.dialog, 'pointerdown', 10, 10);
pointerEvent(f.dialog, 'click', 10, 10);
assert.equal(f.dialog.open, false, 'Clicking the backdrop closes it');
f.openButton.click();

// Finishing a slide must not trigger a delayed scroll either.
f.panels[2].animations.at(-1).finish();
await Promise.resolve();

for (const options of [{ reducedMotion: true }, { animate: false }]) {
  const alternate = fixture(options);
  alternate.openButton.click();
  alternate.name.value = 'Preview';
  alternate.email.value = 'preview@example.invalid';
  alternate.submit();
  assert.equal(alternate.root.dataset.step, '2');
  assert.equal(alternate.panels[1].animations.length, 0);
  assert.equal(alternate.panels[1].querySelector('h3').focusOptions.preventScroll, true);
}

// Rapid navigation cancels stale animation without scrolling or losing input.
const prefilled = fixture();
const nameCheck = prefilled.root.querySelector('[data-identity-check="firstName"]');
const emailCheck = prefilled.root.querySelector('[data-identity-check="email"]');
assert.equal(nameCheck.hidden, true, 'Empty fields never display a success mark');
assert.equal(emailCheck.hidden, true);
prefilled.root.dataset.prefillFirstName = 'Léa';
prefilled.root.dataset.prefillEmail = 'lea@example.invalid';
prefilled.openButton.click();
assert.equal(prefilled.name.value, 'Léa');
assert.equal(prefilled.email.value, 'lea@example.invalid');
assert.equal(nameCheck.hidden, false, 'Valid prefilled first name gets its green check');
assert.equal(emailCheck.hidden, false, 'Valid prefilled email gets its green check');
prefilled.email.value = 'invalid-email';
prefilled.email.dispatchEvent(new Event('input'));
assert.equal(emailCheck.hidden, true, 'An invalid edit immediately removes the check');
assert.equal(nameCheck.hidden, false, 'Checks update independently');
prefilled.name.value = '   ';
prefilled.name.dispatchEvent(new Event('input'));
assert.equal(nameCheck.hidden, true, 'Whitespace alone is not a completed name');
prefilled.name.value = 'Léa';
prefilled.name.dispatchEvent(new Event('change'));
assert.equal(nameCheck.hidden, false);
prefilled.email.value = 'edited@example.invalid';
prefilled.email.dispatchEvent(new Event('input'));
assert.equal(emailCheck.hidden, false, 'Correcting the email restores its check');
prefilled.closeButton.click();
prefilled.openButton.click();
assert.equal(prefilled.email.value, 'edited@example.invalid', 'Never replace customer edits with opt-in data');
assert.equal(emailCheck.hidden, false, 'Reopening keeps the valid-field indicator');

const asyncPrefilled = fixture();
const registrationEvent = new Event('mc2:draftx-registration');
Object.defineProperty(registrationEvent, 'detail', { value: { firstName: 'Léa', email: 'lea@example.invalid' } });
asyncPrefilled.view.dispatchEvent(registrationEvent);
assert.equal(asyncPrefilled.root.querySelector('[data-identity-check="firstName"]').hidden, false, 'Late opt-in prefill updates the checks');
assert.equal(asyncPrefilled.root.querySelector('[data-identity-check="email"]').hidden, false);

const rapid = fixture();
rapid.openButton.click();
rapid.name.value = 'Preview';
rapid.email.value = 'preview@example.invalid';
rapid.submit();
rapid.backs[0].click();
assert.equal(rapid.root.dataset.step, '1');
assert.equal(rapid.panels[1].animations[0].cancelled, true);
assert.equal(rapid.name.value, 'Preview');

function publish(fixture, type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail });
  fixture.view.dispatchEvent(event);
}
const personal = fixture({ preview: false });
const testToken = 'mc2-unit-only-1234567890';
personal.openButton.click();
assert.equal(personal.dialog.open, false, 'Real mode is closed until the MC2 offer is available');
publish(personal, 'mc2:draftx-registration', { firstName: 'Léa', email: 'lea@example.invalid', registrationToken: testToken });
publish(personal, 'mc2:draftx-availability', { available: true });
personal.openButton.click();
assert.equal(personal.dialog.open, true);
personal.email.value = 'changed@example.invalid';
personal.email.dispatchEvent(new Event('input'));
personal.submit();
personal.submit();
assert.equal(personal.mounts[0].identity.registrationToken, testToken, 'Edited purchase email retains the registration reference');
assert.equal(personal.mounts[0].identity.email, 'changed@example.invalid');
publish(personal, 'mc2:draftx-availability', { available: false });
assert.equal(personal.dialog.open, false, 'Expiry closes an already-open payment form');
assert.equal(personal.mounts[0].destroyed, true);
personal.openButton.click();
assert.equal(personal.dialog.open, false);
assert.equal(personal.root.dataset.step, '2', 'No empty payment iframe on a later reopen');
publish(personal, 'mc2:draftx-availability', { available: true });
personal.openButton.click();
personal.plans[0].click();
personal.submit();
assert.equal(personal.mounts[1].identity.registrationToken, testToken);
assert.equal(personal.mounts[1].plan, DRAFTX_PAYMENT_PLANS.six);
const isolated = fixture();
publish(isolated, 'mc2:draftx-registration', { firstName: 'Preview', email: 'preview@example.invalid', registrationToken: testToken });
isolated.openButton.click(); isolated.submit(); isolated.submit();
assert.equal(isolated.mounts[0].identity.registrationToken, undefined, 'Preview never forwards a stored or event token');

assert.deepEqual(Object.keys(DRAFTX_PAYMENT_PLANS), ['six', 'twelve']);
assert.deepEqual(DRAFTX_PAYMENT_PLANS.six, { count: 6, amount: 347, totalLabel: '2 082', checkoutUrl: 'https://sonnycourt.spiffy.co/checkout/38556365' });
assert.deepEqual(DRAFTX_PAYMENT_PLANS.twelve, { count: 12, amount: 197, totalLabel: '2 364', checkoutUrl: 'https://sonnycourt.spiffy.co/checkout/38556364' });
for (const plan of Object.values(DRAFTX_PAYMENT_PLANS)) assert.equal(Number(plan.totalLabel.replaceAll(' ', '')), plan.count * plan.amount);

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const component = read('src/components/mc2/DraftXCheckout.astro');
const planPanelMarkup = component.match(/<fieldset[^>]*data-checkout-step="2"[\s\S]*?<\/fieldset>/)?.[0] || '';
assert.match(planPanelMarkup, /draftx-checkout__plans[\s\S]*<p class="draftx-checkout__plan-commitment">Abonnement sans renouvellement automatique, avec engagement\.<\/p>\s*<button[^>]*>Je valide mon choix/, 'The commitment notice is visible between the plan options and their confirmation');
assert.equal((component.match(/<p class="draftx-checkout__plan-commitment">/g) || []).length, 1, 'Only the plan step receives this new notice');
assert.equal((component.match(/<aside class="draftx-checkout__guarantee"/g) || []).length, 1, 'Only the payment step gets a guarantee reminder');
assert.doesNotMatch(planPanelMarkup, /draftx-checkout__guarantee/);
const paymentPanelMarkup = component.match(/<fieldset[^>]*data-checkout-step="3"[\s\S]*?<\/fieldset>/)?.[0] || '';
assert.match(paymentPanelMarkup, /data-spiffy-slot[\s\S]*draftx-checkout__guarantee[\s\S]*Garantie manifestation · 6 mois[\s\S]*Soit tu manifestes, soit tu es remboursé\.[\s\S]*data-payment-commitment/);
const controller = read('src/lib/mc2-draftx-checkout.mjs');
const sandbox = read('src/components/mc2/DraftXSandbox.astro');
assert.match(component, /data-checkout-step="2"[^>]*hidden disabled/);
assert.match(component, /data-checkout-step="3"[^>]*hidden disabled/);
assert.doesNotMatch(component, /data-progress-step|draftx-checkout__progress|aria-current="step"/);
assert.doesNotMatch(component, /data-plan-summary|plan\.totalLabel|€ au total/);
assert.doesNotMatch(controller, /data-plan-summary|Total :|Engagement :/);
assert.doesNotMatch(controller, /scrollIntoView|scrollTo\(|requestAnimationFrame|centerPanel/);
assert.match(component, /\.draftx-checkout form\s*\{[^}]*display: grid;[^}]*align-items: center;/);
assert.match(component, /\.draftx-checkout__step\s*\{[^}]*grid-area: 1 \/ 1;/);
assert.match(component, /\.draftx-checkout__step\[hidden\]\s*\{[^}]*display: none !important;/);
assert.match(component, /<dialog[^>]*id="draftx-checkout-dialog"[^>]*aria-label=/);
assert.match(component, /data-checkout-open[^>]*aria-haspopup="dialog"/);
const dialogStyles = [...component.matchAll(/\.draftx-checkout__dialog\s*\{([^}]*)\}/g)];
assert.equal(dialogStyles.length, 3, 'Desktop, mobile portrait and phone landscape keep explicit popup sizing');
assert.match(component, /@media \(orientation: landscape\) and \(max-height: 500px\) and \(min-width: 600px\) and \(max-width: 1000px\) \{/, 'Landscape overrides support mobile previews without coarse input');
assert.match(dialogStyles[2][1], /overflow-y: auto;/, 'The whole landscape dialog scrolls, including its header');
for (const [, styles] of dialogStyles) {
  assert.match(styles, /(?:^|;)\s*height: fit-content;/, 'Native modal must size to content, not stretch between its vertical insets');
  assert.doesNotMatch(styles, /(?:^|;)\s*height: auto;/, 'Auto height stretches a native modal to the viewport');
  assert.match(styles, /max-height: calc\(100dvh - \d+px\);/, 'Long steps stay within the viewport');
}
assert.match(component, /\.draftx-checkout__dialog-body\s*\{[^}]*flex: 0 1 auto;/);
assert.match(component, /:global\(html:has\(\.draftx-checkout__dialog\[open\]\)\)\s*\{[^}]*overflow: hidden;/);
assert.match(component, /overscroll-behavior: contain/);
assert.match(controller, /dialog\.showModal\(\)/);
assert.match(controller, /dialog\.addEventListener\('close'/);
const offer = read('src/components/mc2/DealOfferDraftX.astro');
assert.match(offer, /id="video-reviews-video"[^>]*poster="\/media\/draftx-community-testimonials-v2\.webp"/);
const testimonialPoster = readFileSync(new URL('../public/media/draftx-community-testimonials-v2.webp', import.meta.url));
assert.equal(testimonialPoster.subarray(0, 4).toString(), 'RIFF');
assert.equal(testimonialPoster.subarray(8, 12).toString(), 'WEBP');
assert.ok(testimonialPoster.length < 250_000, 'The testimonial poster stays light for the page');
assert.equal((offer.match(/Ta transformation commence aujourd’hui/g) || []).length, 2);
assert.doesNotMatch(offer, /Ton aventure commence aujourd’hui/);
const draftxPage = read('src/pages/mc2/draftx.astro');
assert.match(draftxPage, /id="return-buyer-offer-cta"[^>]*aria-controls="draftx-checkout-dialog"[^>]*aria-haspopup="dialog">\s*Je commence ma transformation\s*<\/button>/);
assert.match(offer, /id="core-price-registration-cta"[^>]*>\s*Je commence ma transformation →\s*<\/button>/);
const endedCtaHandler = draftxPage.match(/returnBuyerOfferCta\?\.addEventListener\('click', function \(\) \{([\s\S]*?)\n\s*\}\);/)?.[1];
assert.ok(endedCtaHandler, 'The end-of-video CTA has an action');
assert.doesNotMatch(endedCtaHandler, /scrollIntoView|scrollTo/);
const endedCtaFixture = fixture();
new Function('document', 'isOfferExpired', 'returnBuyerOfferCta', endedCtaHandler)({
  getElementById(id) {
    assert.equal(id, 'deal-registration');
    return endedCtaFixture.root;
  },
}, false, { disabled: false });
assert.equal(endedCtaFixture.dialog.open, true, 'The end-of-video CTA opens the actual checkout popup');
assert.equal(endedCtaFixture.mounts.length, 0, 'Opening the popup does not start a payment');
assert.doesNotMatch(offer, /Après tes 7 premiers jours à 0 €/);
assert.match(offer, /<span class="draftx-daily-comparison__continuation">Après 7 jours, ta transformation continue…<\/span>/);
assert.equal((offer.match(/Puis 197 €\/mois sur une année\./g) || []).length, 2, 'Both page price summaries use the compact annual wording');
assert.match(planPanelMarkup, /Puis \$\{plan\.amount\} €\/mois sur une année\./);
assert.doesNotMatch(offer + component + controller + read('src/pages/mc2/draftx.astro') + read('src/lib/mc2-draftx-spiffy.mjs'), /€ par mois pendant une année/);
assert.doesNotMatch(offer + component + controller + read('src/pages/mc2/draftx.astro'), /12 (?:versements(?: mensuels)?|mensualités) de 197/);
assert.doesNotMatch(offer, /Ou 347 € par mois pendant 6 mois\./);
assert.match(offer, /<span class="core-total__installments">Premier versement dans 7 jours\.<\/span>/);
assert.match(planPanelMarkup, /Puis \$\{plan\.amount\} €\/mois sur \$\{plan\.count\} mois/);
assert.doesNotMatch(offer + component + controller, /6 versements(?: mensuels)? de 347/);
assert.doesNotMatch(offer, /3 versements de 697 €/);
assert.match(component, /\.draftx-checkout__pay\s*\{[^}]*min-height: 76px;/);
assert.match(component, /\.draftx-checkout__launch\s*\{[^}]*min-height: 88px;/);
assert.doesNotMatch(offer, /two-paths-cost|Le véritable prix de|Continuer seul te demandera/);
assert.match(offer, /class="core-price-cta" id="two-paths-registration-cta"[^>]*aria-haspopup="dialog"/);
assert.match(offer, /twoPathsCta\.addEventListener\('click', openRegistration\)/);
assert.match(offer, /class="two-paths-grid"/);
const afterSignup = offer.match(/<section class="after-signup"[\s\S]*?<\/section>/)?.[0] || '';
assert.match(offer, /class="two-paths-grid"[\s\S]*id="after-signup"[\s\S]*id="two-paths-registration-cta"/, 'The onboarding overview sits after the two paths and before the existing CTA');
assert.equal((afterSignup.match(/<li class="after-signup__step">/g) || []).length, 3);
assert.match(afterSignup, /Tu reçois tes accès par email\.[\s\S]*Tu découvres ton espace de formation\.[\s\S]*Tu commences ta première leçon\./);
assert.doesNotMatch(afterSignup, /Romain|appel|coaching/i, 'The welcome call stays an unannounced extra');
assert.match(offer, /id="deal-sticky-cta"[^>]*>\s*Je commence ⚡\s*<\/button>/);
for (const className of ['core-price-cta']) {
  const styles = offer.match(new RegExp('\\.' + className + '\\s*\\{([^}]*)\\}'))?.[1] || '';
  assert.match(styles, /width: min\(100%, 640px\);/);
  assert.match(styles, /min-height: 84px;/);
}
assert.match(offer, /querySelector\('\[data-checkout-open\]'\)\?\.click\(\)/);
assert.doesNotMatch(offer, /scrollToRegistration/);
assert.match(component, /draftx-checkout__start">Tu commences à <strong>0 €<\/strong> aujourd’hui\./);
assert.match(component, /data-spiffy-slot/);
assert.doesNotMatch(component, /4242|draftx-card-number|draftx-expiry|draftx-cvc/);
assert.match(read('spiffy/mc2-draftx-embedded.html'), /J’accepte les <a href="https:\/\/sonnycourt.com\/cgv\/"/);
assert.doesNotMatch(controller, /\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
assert.match(sandbox, /frame-src 'self' https:\/\/sonnycourt.spiffy.co/);
assert.match(sandbox, /form-action 'none'/);
// Only astro.draftx.config supplies the narrow local MC2 API proxy.
for (const file of ['src/pages/mc2/session.astro', 'src/pages/mc2/replay.astro', 'src/components/mc2/DealOffer.astro', 'astro.config.mjs', 'netlify.toml', 'package.json']) {
  const original = execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const expected = file === 'src/components/mc2/DraftXSandbox.astro'
    ? original.replace(
      "      if (target.origin === location.origin && target.pathname.startsWith('/media/')) return;",
      "      if (target.origin === location.origin && target.pathname.startsWith('/media/')) return;\n      if (target.origin === location.origin && target.pathname === '/cgv/' && !target.search) return;",
    )
    : original;
  assert.equal(read(file), expected, `Unrelated or protected file changed: ${file}`);
}
console.log('PASS — popup, identité transmise, plans Spiffy, changements de rythme, validations et isolation.');
