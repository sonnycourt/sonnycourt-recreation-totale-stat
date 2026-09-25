export const SPIFFY_ORIGIN = 'https://sonnycourt.spiffy.co';
const ALLOWED_CHECKOUTS = new Set(['/checkout/masterclass-es2-27']);
export function cleanEntryRegistrationToken(value) {
  const token = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{16,160}$/.test(token) && !/^(preview|mc2-preview)/i.test(token) ? token : '';
}

export function buildEntrySpiffyUrl(plan, identity, parentHref) {
  const url = new URL(plan.checkoutUrl);
  if (url.origin !== SPIFFY_ORIGIN || !ALLOWED_CHECKOUTS.has(url.pathname)) throw new Error('Checkout non autorisé');
  const parent = new URL(parentHref);
  url.searchParams.set('name_first', String(identity.firstName || '').trim());
  url.searchParams.set('email', String(identity.email || '').trim());
  url.searchParams.set('mc2_entry', '1');
  url.searchParams.set('mc2_parent_origin', parent.origin);
  // Explicitly authorised MC2 reference, supplied after the existing access gate.
  // Never infer it from arbitrary URL parameters or propagate coupons/prices.
  const registrationToken = cleanEntryRegistrationToken(identity.registrationToken);
  if (registrationToken) url.searchParams.set('mc2_token', registrationToken);
  url.searchParams.set('elements', btoa(JSON.stringify({
    modality: 'inline', uid: plan.count, from: parent.origin + parent.pathname, handles: {},
  })));
  return url;
}

export function trustedSpiffyMessage(event, frame) {
  if (event.origin !== SPIFFY_ORIGIN || event.source !== frame.contentWindow) return null;
  let message = event.data;
  if (typeof message === 'string') {
    try { message = JSON.parse(message); } catch { return null; }
  }
  if (!message || typeof message !== 'object') return null;
  // Native SpiffyJS events; only accept our configured post-purchase destination.
  if (message.event === 'order:success' || message.event === 'redirect') {
    const destination = message.data?.forward || message.data?.url || message.url;
    if (typeof destination !== 'string') return null;
    try {
      const redirect = new URL(destination, 'https://sonnycourt.com');
      if (redirect.origin !== 'https://sonnycourt.com' || !['/mc2/confirmation','/mc2/confirmation/'].includes(redirect.pathname) || redirect.username || redirect.password) return null;
      return { redirect: redirect.toString() };
    } catch { return null; }
  }
  if (message.type === 'mc2:entry-spiffy-ready') return { ready: true, identityReady: message.identityReady === true };
  if (message.type !== 'mc2:entry-spiffy-height' && message.event !== 'form:size') return null;
  const height = Number(message.height ?? message.data?.height);
  if (!Number.isFinite(height) || height < 100 || height > 10000) return null;
  return { height: Math.max(180, Math.min(Math.ceil(height), 1800)) };
}

export function mountEntrySpiffy(slot, plan, identity, { track = () => {} } = {}) {
  const observe = (name, meta = {}) => { try { track(name, meta); } catch { /* Never block the provider. */ } };
  const doc = slot.ownerDocument;
  const view = doc.defaultView;
  const parentUrl = new URL(view.location.href);
  const localPreview = ['127.0.0.1', 'localhost'].includes(parentUrl.hostname)
    && parentUrl.searchParams.get('entry_payment_preview') === '1';
  if (localPreview) {
    const preview = doc.createElement('div');
    preview.className = 'entry-spiffy-preview';
    preview.innerHTML = `
      <div class="entry-spiffy-preview__label">Carte bancaire</div>
      <div class="entry-spiffy-preview__card" aria-label="Aperçu du champ carte">
        <span>Numéro de carte</span><span>MM / AA</span><span>CVC</span>
      </div>
      <label class="entry-spiffy-preview__terms"><input type="checkbox" disabled> J’accepte les CGV et le paiement unique de 27 €.</label>
      <button type="button" disabled>PAYER 27 € ET RÉSERVER MA PLACE</button>
      <p>Mode aperçu local : paiement désactivé. Le vrai formulaire fonctionne uniquement sur la preview HTTPS.</p>`;
    slot.replaceChildren(preview);
    slot.classList.remove('is-loading', 'is-recovery');
    slot.classList.add('is-ready');
    slot.setAttribute('aria-busy', 'false');
    observe('payment_local_preview_visible');
    return {
      destroy() {
        slot.replaceChildren();
        slot.classList.remove('is-loading', 'is-ready', 'is-recovery');
        slot.style.removeProperty('min-height');
      },
    };
  }
  const frame = doc.createElement('iframe');
  const status = doc.createElement('p');
  status.className = 'entry-spiffy-loading';
  status.setAttribute('role', 'status');
  status.innerHTML = '<span class="entry-spiffy-loading__spinner" aria-hidden="true"></span><strong>Chargement du paiement sécurisé…</strong><span>Quelques secondes, ne ferme pas cette fenêtre.</span>';
  frame.title = 'Paiement sécurisé — Masterclass et workbook — 27 € en une fois';
  frame.setAttribute('allow', 'payment');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.className = 'entry-spiffy-frame';
  // Reserve the payment area without exposing Spiffy's unstyled bootstrap.
  const reservedHeight = 520;
  frame.style.height = `${reservedHeight}px`;
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  const url = buildEntrySpiffyUrl(plan, identity, view.location.href);
  frame.src = url.toString();
  let loaded = false;
  let ready = false;
  let measuredHeight = 0;
  let revealTimer;
  let fallbackTimer;
  let revealEarliest = 0;
  let revealDeadline = 0;
  let destroyed = false;
  let redirecting = false;
  let manualRetries = 0;
  const standaloneUrl = new URL(url);
  for (const key of ['elements', 'mc2_entry', 'mc2_parent_origin']) standaloneUrl.searchParams.delete(key);
  const addDirectCheckout = () => {
    const link = doc.createElement('a');
    link.href = standaloneUrl.toString();
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Ouvrir le paiement sécurisé';
    status.append(link);
  };
  const addRecoveryActions = () => {
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Réessayer';
    retry.addEventListener('click', () => {
      // Only an explicit user action reloads a failed/unconfirmed checkout.
      // Ignore a stale button if the provider has since confirmed readiness.
      if (destroyed || (loaded && ready && measuredHeight)) return;
      manualRetries += 1;
      observe('payment_frame_retry');
      view.clearTimeout(timeout);
      view.clearTimeout(revealTimer);
      view.clearTimeout(fallbackTimer);
      loaded = false;
      ready = false;
      measuredHeight = 0;
      frame.style.height = `${reservedHeight}px`;
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      status.className = 'entry-spiffy-loading';
      status.innerHTML = '<span class="entry-spiffy-loading__spinner" aria-hidden="true"></span><strong>Chargement du paiement sécurisé…</strong><span>Quelques secondes, ne ferme pas cette fenêtre.</span>';
      slot.classList.remove('is-ready', 'is-recovery');
      slot.classList.add('is-loading');
      slot.style.minHeight = `${reservedHeight}px`;
      slot.setAttribute('aria-busy', 'true');
      timeout = view.setTimeout(showTimeout, 20000);
      frame.src = url.toString();
    });
    status.append(retry);
    // The external checkout is a last resort, after a manual retry fails.
    if (manualRetries > 0) {
      status.append(doc.createTextNode(' · '));
      addDirectCheckout();
    }
  };
  const reveal = (evidence) => {
    if (loaded || destroyed) return;
    loaded = true;
    view.clearTimeout(timeout);
    view.clearTimeout(revealTimer);
    view.clearTimeout(fallbackTimer);
    // A provider message is an enhancement, never a prerequisite for access.
    // Without a size message, allow the native iframe to scroll normally.
    const visibleHeight = measuredHeight || reservedHeight;
    frame.style.height = `${visibleHeight}px`;
    frame.style.opacity = '1';
    frame.style.pointerEvents = 'auto';
    frame.setAttribute('aria-hidden', 'false');
    frame.setAttribute('tabindex', '0');
    slot.classList.remove('is-loading');
    slot.classList.add('is-ready');
    slot.style.minHeight = `${visibleHeight}px`;
    if (evidence === 'provider_ready_and_height') status.remove();
    else {
      slot.classList.add('is-recovery');
      status.className = 'entry-spiffy-recovery';
      status.textContent = 'Si le formulaire ne s’affiche pas : ';
      addRecoveryActions();
    }
    slot.setAttribute('aria-busy', 'false');
    // Visibility is not proof of provider readiness, nor proof of purchase.
    observe('payment_frame_visible', { frame_evidence: evidence });
  };
  frame.onload = () => {
    if (loaded || destroyed) return;
    view.clearTimeout(fallbackTimer);
    // Keep the short anti-flash treatment, but never hide a loaded checkout
    // indefinitely if its custom ready/height bridge is absent or too late.
    fallbackTimer = view.setTimeout(() => reveal('iframe_load_fallback'), 3000);
  };
  const scheduleReveal = () => {
    if (!ready || !measuredHeight || loaded || destroyed) return;
    view.clearTimeout(revealTimer);
    // A short quiet period absorbs startup resizes; the deadline prevents
    // an animated provider element from keeping a ready checkout hidden.
    const now = Date.now();
    const delay = Math.min(Math.max(250, revealEarliest - now), Math.max(0, revealDeadline - now));
    revealTimer = view.setTimeout(() => {
      reveal('provider_ready_and_height');
    }, delay);
  };
  slot.classList.remove('is-ready', 'is-recovery');
  slot.classList.add('is-loading');
  slot.style.minHeight = `${reservedHeight}px`;
  slot.setAttribute('aria-busy', 'true');
  const onMessage = event => {
    const message = trustedSpiffyMessage(event, frame);
    if (!message) return;
    if (message.redirect) {
      if (redirecting) return;
      redirecting = true;
      const destination = new URL(message.redirect);
      destination.searchParams.set('provider', 'spiffy');
      const token = cleanEntryRegistrationToken(identity.registrationToken);
      if (token) destination.searchParams.set('t', token);
      observe('payment_redirect_observed');
      frame.style.pointerEvents = 'none';
      frame.setAttribute('aria-hidden', 'true');
      if (!status.isConnected) slot.prepend(status);
      status.className = 'entry-spiffy-loading';
      status.textContent = 'Paiement confirmé. Ouverture de ta masterclass…';
      slot.classList.remove('is-ready', 'is-recovery');
      slot.classList.add('is-loading');
      slot.setAttribute('aria-busy', 'true');
      const orderId = destination.searchParams.get('order_id') || destination.searchParams.get('orderId') || '';
      (async () => {
        // Confirm server-side before leaving the checkout: a legitimate buyer
        // lands on an already-unlocked token confirmation page, never on the
        // intermediate access gate.
        for (let attempt = 0; attempt < 20 && !destroyed; attempt++) {
          try {
            const response = await view.fetch('/.netlify/functions/mc2-entry-payment-status', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, orderId }), signal: AbortSignal.timeout(20000),
            });
            const result = await response.json();
            if (response.ok && (result.paid || result.historical)) {
              destination.searchParams.delete('provider');
              view.location.assign(destination.pathname + destination.search);
              return;
            }
          } catch { /* Provider data can take a few seconds to propagate. */ }
          await new Promise(resolve => view.setTimeout(resolve, 1500));
        }
        // Keep the paid checkout visible as the recovery surface instead of
        // sending a buyer to an alarming locked confirmation page.
        redirecting = false;
        frame.removeAttribute('aria-hidden');
        status.className = 'entry-spiffy-recovery';
        status.textContent = 'Paiement reçu. La création de ton accès prend quelques instants. Réessaie dans un instant.';
        const retry = doc.createElement('button');
        retry.type = 'button'; retry.textContent = 'OUVRIR MA MASTERCLASS';
        retry.addEventListener('click', () => onMessage(event));
        status.append(doc.createTextNode(' '), retry);
        slot.classList.remove('is-loading');
        slot.classList.add('is-ready', 'is-recovery');
        slot.setAttribute('aria-busy', 'false');
      })();
      return;
    }
    if (message.height) {
      const changed = measuredHeight !== message.height;
      measuredHeight = message.height;
      if (loaded) {
        frame.style.height = `${measuredHeight}px`;
        slot.style.minHeight = `${measuredHeight}px`;
      }
      else if (changed) scheduleReveal();
    }
    if (message.ready) {
      if (!ready) {
        ready = true;
        revealEarliest = Date.now() + 700;
        revealDeadline = Date.now() + 1800;
      }
      slot.dataset.identityTransmitted = String(message.identityReady);
      scheduleReveal();
    }
    // A late handshake restores the normal UI without reloading any inputs.
    if (loaded && ready && measuredHeight) {
      status.remove();
      slot.classList.remove('is-loading', 'is-recovery');
      slot.classList.add('is-ready');
    }
  };
  view.addEventListener('message', onMessage);
  const showTimeout = () => {
    if (loaded || destroyed) return;
    observe('payment_frame_timeout');
    status.textContent = 'Le paiement sécurisé met plus de temps à charger. ';
    addRecoveryActions();
    slot.classList.remove('is-loading');
    slot.classList.add('is-recovery');
    slot.setAttribute('aria-busy', 'false');
  };
  let timeout = view.setTimeout(showTimeout, 20000);
  slot.replaceChildren(status, frame);
  observe('payment_frame_loading');
  return {
    destroy() {
      destroyed = true;
      view.clearTimeout(revealTimer);
      view.clearTimeout(fallbackTimer);
      frame.onload = null;
      view.clearTimeout(timeout);
      view.removeEventListener('message', onMessage);
      slot.replaceChildren();
      slot.classList.remove('is-loading', 'is-ready', 'is-recovery');
      slot.style.removeProperty('min-height');
      delete slot.dataset.identityTransmitted;
    },
  };
}
