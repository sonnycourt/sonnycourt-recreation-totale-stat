import { mountDraftXSpiffy, cleanDraftXRegistrationToken } from './mc2-draftx-spiffy.mjs';
// Only these two user-approved checkouts may be mounted.
export const DRAFTX_PAYMENT_PLANS = Object.freeze({
  six: Object.freeze({ count: 6, amount: 347, totalLabel: '2 082', checkoutUrl: 'https://sonnycourt.spiffy.co/checkout/38556365' }),
  twelve: Object.freeze({ count: 12, amount: 197, totalLabel: '2 364', checkoutUrl: 'https://sonnycourt.spiffy.co/checkout/38556364' }),
});

export function initDraftXCheckout(root, { mountPayment = mountDraftXSpiffy } = {}) {
  if (root.dataset.checkoutReady === 'true') return;
  const form = root.querySelector('form');
  const dialog = root.querySelector('#draftx-checkout-dialog');
  const openButton = root.querySelector('[data-checkout-open]');
  const closeButton = root.querySelector('[data-checkout-close]');
  const panels = Array.from(root.querySelectorAll('[data-checkout-step]'));
  const plans = Array.from(root.querySelectorAll('[data-payment-plan]'));
  const firstName = root.querySelector('#draftx-first-name');
  const email = root.querySelector('#draftx-email');
  const paymentSlot = root.querySelector('[data-spiffy-slot]');
  const status = root.querySelector('#draftx-payment-status');
  const view = root.ownerDocument?.defaultView;
  if (!form || !dialog || !openButton || !closeButton || panels.length !== 3 || !firstName || !email || !paymentSlot || !status) return;
  root.dataset.checkoutReady = 'true';
  let step = 1;
  let activePlan = 'twelve';
  let stepAnimation;
  let returnFocus;
  let backdropPressed = false;
  let paymentInstance;
  let paymentKey = '';
  let identityEdited = false;
  let registrationToken = '';
  let available = Boolean(view?.__mc2DraftX) || root.dataset.checkoutAvailable === 'true';
  // Keep keyboard/reading order aligned with the visual order: the popular
  // plan comes first on mobile; desktop keeps its original six/twelve layout.
  const mobilePlanQuery = view?.matchMedia?.('(max-width: 600px)');
  const syncPlanOrder = () => {
    const firstPlan = plans.find(button => button.dataset.paymentPlan === (mobilePlanQuery?.matches ? 'twelve' : 'six'));
    const list = firstPlan?.parentElement;
    if (list && list.firstElementChild !== firstPlan) list.prepend(firstPlan);
  };
  syncPlanOrder();
  mobilePlanQuery?.addEventListener?.('change', syncPlanOrder);
  const identityChecks = [
    [firstName, root.querySelector('[data-identity-check="firstName"]')],
    [email, root.querySelector('[data-identity-check="email"]')],
  ];
  // These marks indicate a filled, valid-format field, not verified identity.
  const updateIdentityChecks = () => {
    for (const [input, check] of identityChecks) {
      if (check) check.hidden = !(input.value.trim() && input.validity.valid);
    }
  };
  const prefill = detail => {
    if (!view?.__mc2DraftX && detail?.registrationToken !== undefined) registrationToken = cleanDraftXRegistrationToken(detail.registrationToken);
    if (identityEdited || step !== 1) return;
    if (typeof detail?.firstName === 'string') firstName.value = detail.firstName.trim().slice(0, 100);
    if (typeof detail?.email === 'string') email.value = detail.email.trim().slice(0, 254);
    updateIdentityChecks();
  };
  prefill({ firstName: root.dataset.prefillFirstName, email: root.dataset.prefillEmail, registrationToken: root.dataset.registrationToken });
  view?.addEventListener?.('mc2:draftx-registration', event => prefill(event.detail));
  view?.addEventListener?.('mc2:draftx-availability', event => {
    available = event.detail?.available === true;
    if (available) return;
    dialog.close();
    paymentInstance?.destroy();
    paymentInstance = null;
    paymentKey = '';
    if (step === 3) showStep(2, false);
  });
  for (const input of [firstName, email]) {
    for (const eventName of ['input', 'change']) input.addEventListener(eventName, () => {
      identityEdited = true;
      updateIdentityChecks();
    });
  }

  const mountConfirmedPlan = () => {
    if (!view?.__mc2DraftX && !registrationToken) return;
    const nextKey = JSON.stringify([activePlan, firstName.value, email.value, registrationToken]);
    if (paymentInstance && paymentKey === nextKey) return;
    paymentInstance?.destroy();
    paymentKey = nextKey;
    paymentInstance = mountPayment(paymentSlot, DRAFTX_PAYMENT_PLANS[activePlan], {
      firstName: firstName.value, email: email.value,
      ...(registrationToken ? { registrationToken } : {}),
    });
  };

  const updatePlan = () => {
    const plan = DRAFTX_PAYMENT_PLANS[activePlan];
    plans.forEach(button => {
      const selected = button.dataset.paymentPlan === activePlan;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    root.querySelector('[data-payment-schedule]').textContent = activePlan === 'twelve'
      ? `Puis ${plan.amount} €/mois sur une année.`
      : `Puis ${plan.amount} €/mois sur ${plan.count} mois.`;
    root.querySelector('[data-payment-commitment]').textContent = 'Aucun montant prélevé aujourd’hui.';
    status.textContent = '';
  };

  const showStep = (next, moveFocus = true) => {
    const direction = next >= step ? 1 : -1;
    stepAnimation?.cancel();
    step = next;
    root.dataset.step = String(step);
    panels.forEach(panel => {
      const inactive = Number(panel.dataset.checkoutStep) !== step;
      panel.hidden = inactive;
      panel.disabled = inactive;
      panel.inert = inactive;
      panel.setAttribute('aria-hidden', String(inactive));
    });
    if (moveFocus) {
      const panel = panels[step - 1];
      const reducedMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      panel.scrollTop = 0;
      panel.querySelector('h3')?.focus({ preventScroll: true });
      if (!reducedMotion && panel.animate) {
        stepAnimation = panel.animate([
          { transform: `translateX(${-64 * direction}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ], { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        stepAnimation.finished.catch(() => {}); // Quick navigation can cancel a slide.
      }
    }
  };

  openButton.addEventListener('click', () => {
    if (dialog.open || !available) return;
    prefill({ firstName: root.dataset.prefillFirstName, email: root.dataset.prefillEmail, registrationToken: root.dataset.registrationToken });
    returnFocus = root.ownerDocument?.activeElement || openButton;
    dialog.showModal();
    panels[step - 1].querySelector('h3')?.focus({ preventScroll: true });
  });
  closeButton.addEventListener('click', () => dialog.close());
  // Native dialog supplies focus trapping, Escape and an inert background.
  dialog.addEventListener('close', () => {
    stepAnimation?.cancel();
    backdropPressed = false;
    returnFocus?.focus({ preventScroll: true });
  });
  const isBackdrop = event => {
    if (event.target !== dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  dialog.addEventListener('pointerdown', event => { backdropPressed = isBackdrop(event); });
  dialog.addEventListener('click', event => {
    if (backdropPressed && isBackdrop(event)) dialog.close();
    backdropPressed = false;
  });

  plans.forEach(button => button.addEventListener('click', () => {
    const plan = button.dataset.paymentPlan;
    if (!dialog.open || step !== 2 || !Object.hasOwn(DRAFTX_PAYMENT_PLANS, plan)) return;
    if (activePlan !== plan) {
      paymentInstance?.destroy();
      paymentInstance = null;
      paymentKey = '';
    }
    activePlan = plan;
    updatePlan();
  }));
  root.querySelectorAll('[data-checkout-back]').forEach(button => button.addEventListener('click', () => {
    if (!dialog.open || !available) return;
    status.textContent = '';
    showStep(Math.max(1, step - 1));
  }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!dialog.open || !available) return;
    if (step === 1) {
      firstName.value = firstName.value.trim();
      email.value = email.value.trim();
      updateIdentityChecks();
      if (!firstName.reportValidity() || !email.reportValidity()) return;
      showStep(2);
    } else if (step === 2) {
      if (!firstName.reportValidity() || !email.reportValidity()) { showStep(1); return; }
      updatePlan();
      showStep(3);
      mountConfirmedPlan();
    }
    // Step 3 is owned by Spiffy, including card entry, terms, submit and 3DS.
  });
  updatePlan();
  showStep(1, false);
}
