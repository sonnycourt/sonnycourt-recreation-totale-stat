import { visibleArea } from './mc2-journey-tracking.mjs';
const observedOffers = new WeakMap();
const SECTION_TARGETS = [
  ['core_price', '.core-total'], ['bonus_1', '.es2-bonus-card'],
  ['bonus_2', '.es2-bonus-card--morpho'], ['bonus_3', '.es2-bonus-card--trauma-pack'],
  ['bonus_4', '.es2-bonus-card--volt-proof'], ['bonus_5', '[data-limited-bonus]'],
  ['pricing', '.deal-summary'], ['guarantee', '.preview-guarantee'],
  ['proof', '.video-reviews-section'], ['decision', '.two-paths-section'],
];
const SCROLL_MILESTONES = [25, 50, 75, 90, 100];

export function startMc2OfferObservability({ root, route, track }) {
  // New pages use the versioned observer. Already-open legacy pages keep their code.
  if (window.__mc2JourneyV2?.schema === 2) return () => {};
  if (!(root instanceof Element) || typeof track !== 'function') return () => {};
  if (observedOffers.has(root)) return observedOffers.get(root);
  const visit = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const sent = new Set(), pending = new Set();
  const emit = (key, event, value, extra = {}) => {
    if (sent.has(key) || pending.has(key)) return;
    pending.add(key);
    Promise.resolve().then(() => track(event, value, { route, visit_id: visit, event_id: `${visit}-${key}`, ...extra }))
      .then(result => { if (result?.ok || result?.draft) sent.add(key); })
      .catch(() => {}).finally(() => pending.delete(key));
  };
  const measure = () => {
    if (window.__mc2JourneyV2?.schema === 2) return;
    // No impressions underneath the modal, in another tab or a hidden offer.
    if (document.querySelector('#draftx-checkout-dialog[open]') || !visibleArea(root, window)) return;
    emit('visit', 'invitation_visited', null);
    for (const [section, selector] of SECTION_TARGETS) {
      if (visibleArea(root.querySelector(selector), window)) emit(section, 'sales_section_viewed', null, { section });
    }
    const rect = root.getBoundingClientRect();
    const depth = Math.min(100, Math.max(0, Math.round((window.innerHeight - rect.top) / Math.max(1, rect.height) * 100)));
    for (const percent of SCROLL_MILESTONES) {
      if (depth >= percent) emit('depth-' + percent, 'sales_scroll', percent, { percent });
    }
  };
  // Rechecks after tab return, rotation and async layout changes.
  const timer = window.setInterval(measure, 1000);
  window.addEventListener('scroll', measure, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  document.addEventListener('visibilitychange', measure);
  measure();
  const stop = () => {
    window.clearInterval(timer);
    window.removeEventListener('scroll', measure);
    window.removeEventListener('resize', measure);
    document.removeEventListener('visibilitychange', measure);
  };
  observedOffers.set(root, stop);
  return stop;
}
