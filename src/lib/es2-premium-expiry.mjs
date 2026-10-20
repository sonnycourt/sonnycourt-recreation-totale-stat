// Page-level expiry only: this cannot revoke a payment already sent to Spiffy.
export function createPremiumExpiry({ document: doc, navigate, schedule = setTimeout, cancel = clearTimeout }) {
  let expired = false;
  let redirectTimer;
  const savedLinks = new Map();
  return {
    expire() {
      if (expired) return;
      expired = true;
      doc.documentElement.dataset.premiumExpired = 'true';
      doc.querySelectorAll('[data-premium-plan]').forEach(control => {
        control.setAttribute('aria-disabled', 'true');
        if (control.tagName === 'BUTTON') control.disabled = true;
        else {
          savedLinks.set(control, control.getAttribute('href'));
          control.removeAttribute('href');
        }
      });
      // Also cancel a pending SDK load, through the existing dialog close hook.
      doc.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      doc.querySelector('spiffy-checkout-modal [aria-label="Close Checkout"]')?.click();
      const status = doc.getElementById('premium-expiry-status');
      if (status) { status.hidden = false; status.textContent = 'Cette offre est terminée. Tu vas retrouver Delta Vision…'; }
      // Same destination as the explicit decline, without inventing a payment action.
      const decline = doc.querySelector('.premium-choices__decline');
      const destination = decline?.getAttribute('href') || '/delta-vision/merci/';
      redirectTimer = schedule(() => navigate(destination), 600);
    },
    reset() {
      cancel(redirectTimer);
      expired = false;
      delete doc.documentElement.dataset.premiumExpired;
      doc.querySelectorAll('[data-premium-plan]').forEach(control => {
        control.removeAttribute('aria-disabled');
        if (control.tagName === 'BUTTON') control.disabled = false;
        else if (savedLinks.has(control)) control.setAttribute('href', savedLinks.get(control));
      });
      savedLinks.clear();
      const status = doc.getElementById('premium-expiry-status');
      if (status) status.hidden = true;
    },
  };
}
