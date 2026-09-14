export const SPIFFY_ORIGIN = 'https://sonnycourt.spiffy.co';
const ALLOWED_CHECKOUTS = new Set(['/checkout/38556364', '/checkout/38556365']);
export function cleanDraftXRegistrationToken(value) {
  const token = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{16,160}$/.test(token) && !/^(preview|mc2-preview)/i.test(token) ? token : '';
}

export function buildDraftXSpiffyUrl(plan, identity, parentHref) {
  const url = new URL(plan.checkoutUrl);
  if (url.origin !== SPIFFY_ORIGIN || !ALLOWED_CHECKOUTS.has(url.pathname)) throw new Error('Checkout non autorisé');
  const parent = new URL(parentHref);
  url.searchParams.set('name_first', String(identity.firstName || '').trim());
  url.searchParams.set('email', String(identity.email || '').trim());
  url.searchParams.set('mc2_draftx', '1');
  url.searchParams.set('mc2_parent_origin', parent.origin);
  // Explicitly authorised MC2 reference, supplied after the existing access gate.
  // Never infer it from arbitrary URL parameters or propagate coupons/prices.
  const registrationToken = cleanDraftXRegistrationToken(identity.registrationToken);
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
      if (redirect.origin !== 'https://sonnycourt.com' || redirect.pathname !== '/commencer/succes/' || redirect.username || redirect.password) return null;
      return { redirect: redirect.toString() };
    } catch { return null; }
  }
  if (message.type === 'mc2:draftx-spiffy-ready') return { ready: true, identityReady: message.identityReady === true };
  if (message.type !== 'mc2:draftx-spiffy-height' && message.event !== 'form:size') return null;
  const height = Number(message.height ?? message.data?.height);
  if (!Number.isFinite(height) || height < 100 || height > 10000) return null;
  return { height: Math.max(180, Math.min(Math.ceil(height), 1800)) };
}

export function mountDraftXSpiffy(slot, plan, identity) {
  const doc = slot.ownerDocument;
  const view = doc.defaultView;
  const frame = doc.createElement('iframe');
  const status = doc.createElement('p');
  status.className = 'draftx-spiffy-loading';
  status.setAttribute('role', 'status');
  status.textContent = 'Connexion au paiement sécurisé…';
  frame.title = plan.count === 12
    ? `Inscription sécurisée — ${plan.amount} €/mois sur une année`
    : `Inscription sécurisée — ${plan.amount} €/mois sur ${plan.count} mois`;
  frame.setAttribute('allow', 'payment');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.className = 'draftx-spiffy-frame';
  frame.style.height = '420px';
  const url = buildDraftXSpiffyUrl(plan, identity, view.location.href);
  frame.src = url.toString();
  let loaded = false;
  slot.setAttribute('aria-busy', 'true');
  const onMessage = event => {
    const message = trustedSpiffyMessage(event, frame);
    if (!message) return;
    if (message.redirect) {
      const destination = new URL(message.redirect);
      destination.searchParams.set('provider', 'spiffy');
      const token = cleanDraftXRegistrationToken(identity.registrationToken);
      if (token) destination.searchParams.set('t', token);
      // Navigation is not proof of purchase: the existing status endpoint verifies it.
      view.location.assign(destination.toString());
      return;
    }
    if (message.height) frame.style.height = `${message.height}px`;
    if (message.ready) {
      loaded = true;
      view.clearTimeout(timeout);
      status.remove();
      slot.setAttribute('aria-busy', 'false');
      slot.dataset.identityTransmitted = String(message.identityReady);
    }
  };
  view.addEventListener('message', onMessage);
  const timeout = view.setTimeout(() => {
    if (loaded) return;
    status.textContent = 'Le paiement sécurisé met plus de temps à charger. ';
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Réessayer';
    retry.addEventListener('click', () => { frame.src = url.toString(); });
    status.append(retry);
    slot.setAttribute('aria-busy', 'false');
  }, 20000);
  slot.replaceChildren(status, frame);
  return {
    destroy() {
      view.clearTimeout(timeout);
      view.removeEventListener('message', onMessage);
      slot.replaceChildren();
      delete slot.dataset.identityTransmitted;
    },
  };
}
