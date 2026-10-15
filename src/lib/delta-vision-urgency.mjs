// Browser-scoped offer, explicitly accepted by Sonny. Not a Spiffy payment lock:
// a direct legacy checkout link remains usable; clearing all storage resets identity.
export const OFFER_KEY = 'dv_launch_deadline_v1';
export const OFFER_DURATION_MS = (23 * 3600 + 17 * 60 + 34) * 1000;

function deadlineValue(value) {
  if (!/^\d{10,16}$/.test(String(value ?? ''))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function rememberedDeadline({now, readLocal, readCookie, writeLocal, writeCookie}) {
  const safely = fn => { try { return fn(); } catch { return null; } };
  const raw = [safely(readLocal), safely(readCookie)];
  const saved = raw.map(deadlineValue).filter(x => x !== null);
  // Earliest value always wins; reloading, opening a tab or deleting only one
  // storage mechanism must never extend the offer. Far-future corruption fails closed.
  let end = saved.length ? Math.min(...saved) : raw.some(x => x != null && x !== '') ? now : now + OFFER_DURATION_MS;
  if (end > now + OFFER_DURATION_MS) end = now;
  safely(() => writeLocal(String(end)));
  safely(() => writeCookie(String(end)));
  const persisted = [safely(readLocal), safely(readCookie)].some(x => deadlineValue(x) === end);
  return persisted ? end : now; // No rolling timer when storage is unavailable.
}

export function offerState(end, now, config) {
  const expired = now >= end;
  return {
    expired,
    price: expired ? config.standardPrice : config.price,
    checkoutUrl: expired ? config.standardCheckoutUrl : config.checkoutUrl,
    remaining: Math.max(0, Math.ceil((end - now) / 1000)),
  };
}

export function initDeltaUrgency(doc, win, config) {
  const cookieValue = () => doc.cookie.split(';').map(x => x.trim()).find(x => x.startsWith(OFFER_KEY + '='))?.slice(OFFER_KEY.length + 1);
  const persistence = {
    readLocal: () => win.localStorage.getItem(OFFER_KEY),
    readCookie: cookieValue,
    writeLocal: value => win.localStorage.setItem(OFFER_KEY, value),
    writeCookie: value => { doc.cookie = `${OFFER_KEY}=${value}; Max-Age=34560000; Path=/; SameSite=Lax${win.location.protocol === 'https:' ? '; Secure' : ''}`; },
  };
  let end = rememberedDeadline({now: Date.now(), ...persistence});
  const panels = [...doc.querySelectorAll('[data-dv-urgency]')];
  const prices = [...doc.querySelectorAll('[data-dv-price]')];
  const links = [...doc.querySelectorAll('[data-dv-buy]')];
  let previousPrice;
  function render() {
    const state = offerState(end, Date.now(), config);
    const values = {hours: Math.floor(state.remaining / 3600), minutes: Math.floor(state.remaining / 60) % 60, seconds: state.remaining % 60};
    panels.forEach(panel => {
      panel.hidden = state.expired;
      Object.entries(values).forEach(([key, value]) => {
        const node = panel.querySelector(`[data-${key}]`);
        if (node) node.textContent = String(value).padStart(2, '0');
      });
    });
    if (previousPrice !== state.price) {
      prices.forEach(node => { node.textContent = String(state.price); });
      links.forEach(link => {
        link.href = state.checkoutUrl;
        if (link.hasAttribute('aria-label')) link.setAttribute('aria-label', `Je commence Delta Vision — ${state.price} euros`);
      });
      doc.querySelectorAll('.price-card').forEach(card => card.setAttribute('aria-label', `${state.price} euros, au lieu de ${config.referencePrice} euros`));
      doc.querySelectorAll('.price-launch').forEach(node => { node.textContent = state.expired ? 'Delta Vision' : 'Offre de lancement'; });
      previousPrice = state.price;
    }
    doc.documentElement.dataset.dvOffer = state.expired ? 'standard' : 'launch';
    return state;
  }
  function sync() {
    end = Math.min(end, rememberedDeadline({now: Date.now(), ...persistence}));
    render();
  }
  render();
  const interval = win.setInterval(render, 1000);
  win.addEventListener('storage', event => { if (event.key === OFFER_KEY || event.key === null) sync(); });
  win.addEventListener('pageshow', sync);
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) sync(); });
  // Recheck at the exact moment of navigation, including background-tab throttling.
  links.forEach(link => ['click','auxclick','contextmenu'].forEach(type => link.addEventListener(type, sync, true)));
  return {render, sync, destroy: () => win.clearInterval(interval)};
}
