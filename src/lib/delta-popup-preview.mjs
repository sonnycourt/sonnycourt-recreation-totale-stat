import { initDeltaUrgency, OFFER_KEY, OFFER_DURATION_MS } from './delta-vision-urgency.mjs';
// Local visual states use the real offer renderer, but isolated in-memory storage.
// No real deadline or cookie is reset. Production never enters this branch.
export function initDeltaPreviewOffer(doc, win, config) {
  if (!doc.querySelector('[data-dvp-dialog]') || !['localhost', '127.0.0.1', '[::1]'].includes(win.location.hostname)) return null;
  const expired = new URLSearchParams(win.location.search).get('preview-offer') === 'expired';
  const memory = new Map([[OFFER_KEY, String(Date.now() + (expired ? -1000 : OFFER_DURATION_MS))]]);
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  let cookie = '';
  const proxyDoc = new Proxy(doc, {
    get(target, key) { if (key === 'cookie') return cookie; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; },
    set(target, key, value) { if (key === 'cookie') { cookie = value.split(';')[0]; return true; } return Reflect.set(target, key, value, target); },
  });
  const proxyWin = new Proxy(win, { get(target, key) { if (key === 'localStorage') return storage; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } });
  return initDeltaUrgency(proxyDoc, proxyWin, config);
}

// Design-only prototype: never register a subscriber or load a payment provider.
export function initDeltaPopupPreview(doc = document, win = window) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(win.location.hostname)) return;
  const dialog = doc.querySelector('[data-dvp-dialog]');
  if (!dialog || dialog.dataset.bound) return;
  dialog.dataset.bound = 'true';
  let opener, lastOffer;
  const form = dialog.querySelector('[data-dvp-identity]');
  const message = dialog.querySelector('[data-dvp-message]');
  const show = step => {
    dialog.dataset.step = step;
    for (const panel of dialog.querySelectorAll('[data-dvp-panel]')) {
      const active = panel.dataset.dvpPanel === step;
      panel.hidden = !active; panel.inert = !active;
    }
    for (const item of dialog.querySelectorAll('[data-dvp-step]')) {
      if (item.dataset.dvpStep === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-done', step === 'payment' && item.dataset.dvpStep === 'identity');
    }
    dialog.setAttribute('aria-labelledby', `dvp-title-${step}`);
    dialog.scrollTop = 0;
    dialog.querySelector(`#dvp-title-${step}`).focus({ preventScroll: true });
  };
  const updateOffer = () => {
    const offer = doc.documentElement.dataset.dvOffer;
    if (offer === lastOffer) return;
    dialog.querySelector('[data-dvp-discount]').hidden = offer === 'standard';
    if (lastOffer === 'launch' && offer === 'standard') {
      message.textContent = 'L’offre de lancement est terminée. Le tarif est maintenant de 147 €.';
      dialog.querySelector('[data-dvp-terms]').checked = false;
    }
    lastOffer = offer;
  };
  new MutationObserver(updateOffer).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-dv-offer'] });
  updateOffer();
  const open = link => { opener = link; dialog.showModal(); show(dialog.dataset.step || 'identity'); updateOffer(); };
  for (const link of doc.querySelectorAll('[data-dv-buy]')) {
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault(); open(link);
    });
  }
  dialog.querySelector('[data-dvp-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus({ preventScroll: true }));
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.querySelector('[data-dvp-back]').addEventListener('click', () => show('identity'));
  form.elements.firstName.addEventListener('input', () => form.elements.firstName.setCustomValidity(''));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const first = form.elements.firstName, email = form.elements.email;
    first.setCustomValidity(first.value.trim() ? '' : 'Indique ton prénom.');
    if (!form.reportValidity()) return;
    // Identity stays solely in the DOM; never in a URL or browser storage.
    dialog.querySelector('[data-dvp-email]').textContent = email.value.trim();
    message.textContent = '';
    show('payment');
  });
  dialog.querySelector('[data-dvp-pay]').addEventListener('click', () => {
    message.textContent = 'Aperçu local : le paiement n’est pas activé. Aucune inscription ni aucun débit ne sera effectué.';
  });
  if (new URLSearchParams(win.location.search).get('popup') === '1') open(doc.querySelector('[data-dv-buy]'));
}
