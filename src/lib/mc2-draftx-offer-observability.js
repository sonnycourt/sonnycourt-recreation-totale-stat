const observedOffers = new WeakMap();

const SECTION_TARGETS = Object.freeze([
  ['core_price', '.core-total'],
  ['bonus_1', '.es2-bonus-card'],
  ['bonus_5', '[data-limited-bonus]'],
  ['pricing', '.deal-summary'],
  ['guarantee', '.preview-guarantee'],
  ['proof', '.video-reviews-section'],
  ['decision', '.two-paths-section'],
]);

const SCROLL_MILESTONES = Object.freeze([25, 50, 75, 90, 100]);

function offerVisitId() {
  const nonce = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `mc2-offer-${nonce}`;
}

function visibleEnough(entry) {
  if (!entry.isIntersecting) return false;
  const requiredHeight = Math.min(120, Math.max(40, entry.boundingClientRect.height * 0.12));
  return entry.intersectionRect.height >= requiredHeight;
}

/**
 * Observe les étapes diagnostiques de l'offre sans jamais intervenir dans son UI.
 * Les erreurs réseau restent best-effort : aucun événement ne peut bloquer le
 * lecteur, l'offre ou le checkout.
 */
export function startMc2OfferObservability({ root, route, track }) {
  if (!(root instanceof Element) || typeof track !== 'function') return () => {};
  if (observedOffers.has(root)) return observedOffers.get(root);

  const visitId = offerVisitId();
  const cleanups = [];
  const emittedSections = new Set();
  const emittedScroll = new Set();

  function emit(eventName, value, metadata = {}) {
    try {
      Promise.resolve(track(eventName, value, {
        route,
        visit_id: visitId,
        ...metadata,
      })).catch(() => {});
    } catch {
      // Le tracking ne doit jamais affecter le parcours commercial.
    }
  }

  emit('invitation_visited', null, {
    referrer: document.referrer || 'direct',
  });

  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const section = entry.target.getAttribute('data-mc2-observed-section');
        if (!section || emittedSections.has(section) || !visibleEnough(entry)) return;
        emittedSections.add(section);
        sectionObserver.unobserve(entry.target);
        emit('sales_section_viewed', null, { section });
      });
    }, { threshold: [0, 0.01, 0.12, 0.25] });

    SECTION_TARGETS.forEach(([section, selector]) => {
      const element = root.querySelector(selector);
      if (!element) return;
      element.setAttribute('data-mc2-observed-section', section);
      sectionObserver.observe(element);
    });
    cleanups.push(() => sectionObserver.disconnect());
  }

  let scrollFrame = 0;
  function measureOfferDepth() {
    scrollFrame = 0;
    const rect = root.getBoundingClientRect();
    const rootTop = rect.top + window.scrollY;
    const rootHeight = Math.max(1, root.scrollHeight || rect.height);
    const viewedHeight = window.scrollY + window.innerHeight - rootTop;
    const depth = Math.max(0, Math.min(100, Math.floor((viewedHeight / rootHeight) * 100)));
    SCROLL_MILESTONES.forEach((milestone) => {
      if (depth < milestone || emittedScroll.has(milestone)) return;
      emittedScroll.add(milestone);
      emit('sales_scroll', milestone, { percent: milestone });
    });
  }
  function scheduleDepthMeasure() {
    if (scrollFrame) return;
    scrollFrame = window.requestAnimationFrame(measureOfferDepth);
  }
  window.addEventListener('scroll', scheduleDepthMeasure, { passive: true });
  window.addEventListener('resize', scheduleDepthMeasure, { passive: true });
  cleanups.push(() => {
    window.removeEventListener('scroll', scheduleDepthMeasure);
    window.removeEventListener('resize', scheduleDepthMeasure);
    if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
  });
  scheduleDepthMeasure();

  const stop = () => cleanups.splice(0).forEach((cleanup) => cleanup());
  observedOffers.set(root, stop);
  return stop;
}
