import { mountDraftXSpiffy } from './es2-special-spiffy.mjs';

export function mountSpecialPayment(slot, plan, identity) {
  let destroyed = false, payment;
  const doc = slot.ownerDocument, view = doc.defaultView;
  const controller = new AbortController();
  const load = async () => {
    slot.textContent = 'Connexion au paiement sécurisé…';
    try {
      const response = await view.fetch('/.netlify/functions/es2-special-receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action: 'prepare', email: identity.email, firstName: identity.firstName, plan: plan.count === 1 ? 'once' : 'twelve' }),
      });
      const result = await response.json();
      if (!response.ok || !/^es2r_[a-f0-9]{48}$/.test(result.token)) throw new Error(result.error || 'Connexion indisponible. Réessaie dans un instant.');
      if (destroyed) return;
      payment = mountDraftXSpiffy(slot, plan, { ...identity, registrationToken: result.reference }, {
        onRedirect() { view.location.assign('/es2-offre-speciale/confirmation/?t=' + encodeURIComponent(result.token)); },
      });
    } catch (error) {
      if (destroyed) return;
      slot.textContent = error.message || 'Connexion indisponible.';
      const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = 'Réessayer';
      retry.addEventListener('click', load); slot.append(retry);
    }
  };
  load();
  return { destroy() { destroyed = true; controller.abort(); payment?.destroy(); slot.replaceChildren(); } };
}
