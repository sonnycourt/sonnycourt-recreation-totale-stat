// Analytics only: never reads identity fields, card data or alters access/timers.
export function visibleArea(element, view) {
  if (!element || view.document.visibilityState !== 'visible') return false;
  const rect = element.getBoundingClientRect();
  const style = view.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none'
    && rect.width > 0 && rect.height > 0
    && Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0) >= Math.min(40, rect.height)
    && Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0) > 0;
}

export function activePlayback({ visible, paused, seeking, readyState, previous, current, elapsed }) {
  return visible && !paused && !seeking && readyState >= 2 && elapsed > 0 && elapsed <= 3
    && current > previous && current - previous <= elapsed * 2.5;
}

export function startMc2JourneyTracking(root) {
  const view = root.ownerDocument.defaultView;
  const doc = root.ownerDocument;
  const uid = () => view.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const visit = uid();
  let opener = 'checkout-launch';
  const capture = event => {
    const button = event.target.closest?.('[aria-controls="draftx-checkout-dialog"], [data-checkout-open]');
    if (button && event.isTrusted) opener = button.id || 'checkout-launch';
  };
  doc.addEventListener('click', capture, true);
  const track = (event, meta = {}) => {
    const route = view.location.pathname;
    const payload = { token: root.dataset.registrationToken, event,
      meta: { route, page_path: route, visit_id: visit, event_id: uid(), ...meta } };
    if (view.__mc2DraftX || new URLSearchParams(view.location.search).get('preview') === 'dev') {
      view.__mc2DraftX?.record?.(event, payload.meta);
      return;
    }
    if (!payload.token) return;
    const send = async (attempt = 0) => {
      try {
        const response = await view.fetch('/.netlify/functions/track-mc2-event', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), keepalive: true,
        });
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) return;
      } catch { /* Retry transient failures without blocking the UI. */ }
      if (attempt < 3) view.setTimeout(() => send(attempt + 1), 1000 * 2 ** attempt);
    };
    void send();
  };
  let previousTime = 0, previousNow = view.performance.now(), previousVisible = false;
  let minute = -1, activeSeconds = 0, offerAvailable = false, offerSeen = false;
  const readyFrames = new WeakSet();
  const flush = () => {
    if (activeSeconds > 0) track('video_active_presence', { minute, active_seconds: Math.round(activeSeconds * 10) / 10 });
    activeSeconds = 0;
  };
  const interval = view.setInterval(() => {
    const video = doc.querySelector('#masterclass-video, #replay-video');
    const now = view.performance.now();
    const elapsed = (now - previousNow) / 1000;
    const visible = doc.visibilityState === 'visible';
    const current = Number(video?.currentTime || 0);
    const nextMinute = Math.floor(current / 60);
    if (nextMinute !== minute) { flush(); minute = nextMinute; }
    const playing = video && activePlayback({ visible: visible && previousVisible, paused: video.paused,
      seeking: video.seeking, readyState: video.readyState, previous: previousTime, current, elapsed });
    if (playing) activeSeconds += elapsed;
    const available = root.dataset.checkoutAvailable === 'true';
    const frame = root.querySelector('.draftx-spiffy-frame');
    if (root.dataset.step === '3' && doc.querySelector('#draftx-checkout-dialog[open]')
        && frame?.style.opacity === '1' && !readyFrames.has(frame) && visibleArea(frame, view)) {
      readyFrames.add(frame);
      track('checkout_payment_ready', { step: 3 });
    }
    if (available && visible && !offerAvailable) {
      offerAvailable = true;
      track('offer_available_present', { current_second: Math.floor(current), is_playing: Boolean(playing) });
    }
    if (available && !offerSeen && visibleArea(doc.querySelector('#deal-offer-content'), view)
        && !doc.querySelector('#draftx-checkout-dialog[open]')) {
      offerSeen = true;
      track('offer_actually_seen', { current_second: Math.floor(current), is_playing: Boolean(playing) });
    }
    if (activeSeconds >= 10) flush();
    previousTime = current; previousNow = now; previousVisible = visible;
  }, 1000);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) { flush(); previousVisible = false; } });
  view.addEventListener('pagehide', flush);
  // A closed checkout is not asserted to be a lost purchase (they may reopen).
  return (event, meta) => track(event, { button_id: opener, ...meta });
}
