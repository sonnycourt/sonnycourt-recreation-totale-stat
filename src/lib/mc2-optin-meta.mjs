// Attribution publicitaire de la page MC2 commune. Aucun remplacement de fetch,
// du stockage, du choix de créneau ou du parcours d'inscription.
const PIXEL_ID = '3367958190030822';
const STORAGE_KEY = 'meta_tracking_params';
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];

export function createMc2MetaOptin({ window: win, document: doc, funnelId, variant, disabled = false }) {
  function cookie(name) {
    try {
      const entry = doc.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='));
      return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
    } catch { return null; }
  }

  function captureTraffic() {
    let current = {};
    try {
      let stored = null;
      try { stored = JSON.parse(win.localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
      const recent = stored && Number.isFinite(stored.captured_at)
        && Date.now() - stored.captured_at >= 0
        && Date.now() - stored.captured_at < ATTRIBUTION_TTL_MS;
      const params = new URLSearchParams(win.location.search);
      for (const field of FIELDS) {
        if (params.get(field)) current[field] = params.get(field).slice(0, 255);
      }
      if (Object.keys(current).length) {
        current.captured_at = recent && current.fbclid && current.fbclid === stored.fbclid
          ? stored.captured_at : Date.now();
        try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch {}
        return current;
      }
      if (recent) return stored;
    } catch {}
    return current;
  }

  const traffic = captureTraffic();
  // Keep one ID across partial capture, completion and a retry. The server
  // returns the exact IDs to use for browser/CAPI deduplication.
  const leadEventId = 'mc2-lead-' + funnelId;
  const initialFbc = cookie('_fbc');
  const clickFbc = traffic.fbclid ? 'fb.1.' + (traffic.captured_at || Date.now()) + '.' + traffic.fbclid : null;
  const sent = new Set();

  function startPixel() {
    if (disabled || win.__MC2_META_OPTIN_PIXEL_STARTED__) return;
    win.__MC2_META_OPTIN_PIXEL_STARTED__ = true;
    if (!win.fbq) {
      const fbq = win.fbq = function () {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
      };
      if (!win._fbq) win._fbq = fbq;
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
    }
    function load() {
      if (doc.querySelector('script[data-sonny-meta-pixel]')) return;
      const script = doc.createElement('script');
      script.async = true;
      script.dataset.sonnyMetaPixel = 'true';
      script.src = 'https://connect.facebook.net/en_US/fbevents.js';
      doc.head.appendChild(script);
    }
    function schedule() {
      if (win.requestIdleCallback) win.requestIdleCallback(load, { timeout: 1500 });
      else win.setTimeout(load, 800);
    }
    win.addEventListener('pointerdown', load, { once: true, passive: true });
    win.addEventListener('keydown', load, { once: true });
    if (doc.readyState === 'complete') schedule();
    else win.addEventListener('load', schedule, { once: true });
    win.fbq('init', PIXEL_ID);
    win.fbq('track', 'PageView');
  }
  try { startPixel(); } catch { /* Tracking must never block registration. */ }

  return {
    getPayload() {
      return {
        traffic_source: 'meta_ad',
        utm_source: traffic.utm_source || 'meta',
        utm_medium: traffic.utm_medium || 'paid',
        utm_campaign: traffic.utm_campaign || null,
        utm_content: traffic.utm_content || null,
        utm_term: traffic.utm_term || null,
        // A new ad click takes precedence over the previous click's cookie.
        meta_fbc: clickFbc || cookie('_fbc') || initialFbc,
        meta_fbp: cookie('_fbp'),
        meta_event_id: leadEventId,
        optin_variant: variant,
        optin_funnel_id: funnelId,
      };
    },
    fireEvents(events) {
      if (disabled || !Array.isArray(events)) return;
      for (const event of events) {
        if (!event || !['Lead', 'EmailCaptured'].includes(event.eventName) || !event.eventId) continue;
        const key = event.eventName + ':' + event.eventId;
        if (sent.has(key)) continue;
        try {
          if (typeof win.fbq !== 'function') continue;
          win.fbq(event.eventName === 'Lead' ? 'track' : 'trackCustom', event.eventName, {
            content_name: event.contentName || 'Masterclass ES2',
            optin_variant: variant,
          }, { eventID: event.eventId });
          sent.add(key);
        } catch { /* Pixel/ad blockers must never interrupt the MC2 redirect. */ }
      }
    },
  };
}
