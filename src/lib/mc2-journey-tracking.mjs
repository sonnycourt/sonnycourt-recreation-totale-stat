import { createTrackingTransport } from './mc2-tracking-transport.mjs';
import { trackingId, trackingMedia, TRACKING_BUILD, sanitizeTrackingMeta } from './mc2-tracking-contract.mjs';

export function visibleArea(element, view, minimum = 40) {
  if (!element || view.document.visibilityState !== 'visible') return false;
  const rect = element.getBoundingClientRect(), style = view.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity ?? 1) !== 0
    && rect.width > 0 && rect.height > 0
    && Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0) >= Math.min(minimum, rect.height)
    && Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0) > 0;
}
export function activePlayback({ visible, paused, seeking, readyState, previous, current, elapsed, rate = 1 }) {
  return visible && !paused && !seeking && readyState >= 2 && elapsed > 0 && elapsed <= 3
    && current > previous && current - previous <= elapsed * Math.min(2.5, Math.max(1.25, rate + 0.35));
}
const SECTIONS = [
  ['core_price', '.core-total'], ['bonus_1', '.es2-bonus-card'], ['bonus_2', '.es2-bonus-card--morpho'],
  ['bonus_3', '.es2-bonus-card--trauma-pack'], ['bonus_4', '.es2-bonus-card--volt-proof'],
  ['bonus_5', '[data-limited-bonus]'], ['pricing', '.deal-summary'], ['guarantee', '.preview-guarantee'],
  ['proof', '.video-reviews-section'], ['decision', '.two-paths-section'],
];
export function startMc2JourneyTracking(root) {
  if (root.__mc2JourneyV2) return root.__mc2JourneyV2;
  const view = root.ownerDocument.defaultView, doc = root.ownerDocument;
  const route = view.location.pathname.endsWith('/') ? view.location.pathname : view.location.pathname + '/';
  if (!['/mc2/session/', '/mc2/replay/'].includes(route)) return () => {};
  const preview = Boolean(view.__mc2DraftX) || new URLSearchParams(view.location.search).get('preview') === 'dev'
    || ['localhost', '127.0.0.1'].includes(view.location.hostname);
  const transport = preview ? null : createTrackingTransport(view);
  const visit = trackingId(view), media = trackingMedia(route);
  const observed = new Set(), dwell = new Map();
  let token = '', prior = null, interval = null, opener = 'checkout-launch', attempt = '';
  let lastStateAt = 0, lastGestureAt = 0, scrollY = view.scrollY || 0, lastDiagnosticAt = 0, lastDropped = 0, observerErrors = 0, reportedErrors = 0, lastRejected = 0;
  const safe = fn => (...args) => { try { return fn(...args); } catch { observerErrors++; } };
  const emit = (event_name, metadata = {}, once = '') => {
    if (!token || (once && observed.has(once))) return;
    const event = { event_id: trackingId(view), token, event_name, visit_id: visit, route,
      client_occurred_at: new Date().toISOString(), metadata: sanitizeTrackingMeta({ tracker_build: TRACKING_BUILD, ...metadata }) };
    if (once) observed.add(once);
    if (preview) view.__mc2DraftX?.record?.('v2:' + event_name, event.metadata);
    else transport.enqueue(event);
  };
  const flushInterval = () => { if (interval) emit('playback_interval', interval); interval = null; };
  const capture = safe(event => {
    const button = event.target.closest?.('[aria-controls="draftx-checkout-dialog"], [data-checkout-open]');
    if (button && event.isTrusted) opener = button.id || 'checkout-launch';
  });
  const gesture = safe(event => {
    if (!event.isTrusted) return;
    if (event.type === 'keydown' && !['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(event.key)) return;
    lastGestureAt = Date.now();
  });
  const onScroll = safe(() => {
    const current = view.scrollY || 0;
    if (Math.abs(current - scrollY) >= 12 && Date.now() - lastGestureAt < 2000
      && !doc.querySelector('#draftx-checkout-dialog[open]')
      && visibleArea(doc.querySelector('#deal-offer-content'), view)) emit('offer_scroll_started', {}, 'scroll');
    scrollY = current;
  });
  const visibleForOneSecond = (key, element, now, enabled) => {
    if (!enabled || !visibleArea(element, view, 80)) { dwell.delete(key); return false; }
    if (!dwell.has(key)) dwell.set(key, now);
    return now - dwell.get(key) >= 1000;
  };
  const read = () => {
    const video = doc.querySelector('#masterclass-video, #replay-video');
    let frames = null;
    try { const q = video?.getVideoPlaybackQuality?.(); frames = q?.totalVideoFrames > 0 ? q.totalVideoFrames : null; } catch {}
    return { video, mono: view.performance.now(), wall: Date.now(), position: Number(video?.currentTime || 0),
      foreground: doc.visibilityState === 'visible', paused: !video || video.paused || video.ended,
      seeking: Boolean(video?.seeking), readyState: Number(video?.readyState || 0), rate: Number(video?.playbackRate || 1), frames,
      fullscreen: Boolean(doc.fullscreenElement || video?.webkitDisplayingFullscreen),
      picture_in_picture: Boolean(doc.pictureInPictureElement) };
  };
  const tick = safe(() => {
    const nextToken = String(root.dataset.registrationToken || '').trim();
    if (nextToken !== token && !(preview && token === 'preview-local' && !nextToken)) {
      flushInterval(); token = nextToken; prior = null; observed.clear(); dwell.clear();
    }
    if (!token && !preview) return;
    if (preview && !token) token = 'preview-local';
    emit('journey_started', {}, 'journey');
    const state = read(), elapsed = prior ? (state.mono - prior.mono) / 1000 : 0;
    const advancing = prior && activePlayback({ visible: true, paused: state.paused || prior.paused,
      seeking: state.seeking || prior.seeking, readyState: state.readyState,
      previous: prior.position, current: state.position, elapsed, rate: state.rate });
    const frameSupported = state.frames !== null && prior != null && prior.frames !== null;
    const framesAdvanced = frameSupported && state.frames > prior.frames;
    const foreground = state.foreground && prior?.foreground;
    if (advancing) {
      emit('playback_started', { current_second: state.position, foreground: Boolean(foreground) }, 'playback');
      const signature = `${foreground}:${frameSupported}:${framesAdvanced}:${state.rate}`;
      if (interval && (interval.signature !== signature || interval.elapsed_seconds + elapsed > 15)) flushInterval();
      if (!interval) interval = { signature, position_start: prior.position, position_end: state.position,
        interval_started_at: new Date(prior.wall).toISOString(), elapsed_seconds: 0,
        foreground: Boolean(foreground), frames_supported: frameSupported, frames_advanced: Boolean(framesAdvanced), playback_rate: state.rate };
      interval.position_end = state.position; interval.interval_ended_at = new Date(state.wall).toISOString(); interval.elapsed_seconds += elapsed;
      const useful = foreground && (!frameSupported || framesAdvanced);
      if (useful && prior.position <= media.cta && state.position >= media.cta) {
        emit('cta_playback_present', { current_second: state.position, foreground: true, frames_supported: frameSupported, frames_advanced: Boolean(framesAdvanced) }, 'cta');
      }
      if (useful && state.position >= media.cta) emit('offer_playback_present', { current_second: state.position, foreground: true }, 'offer-playback');
      if (interval.elapsed_seconds >= 14) flushInterval();
    } else flushInterval();
    if (state.wall - lastStateAt >= 15000) {
      emit('player_state', { current_second: state.position, foreground: state.foreground, paused: Boolean(state.paused), seeking: state.seeking,
        is_playing: Boolean(advancing), fullscreen: state.fullscreen, picture_in_picture: state.picture_in_picture,
        frames_supported: frameSupported, frames_advanced: Boolean(framesAdvanced) });
      lastStateAt = state.wall;
    }
    const available = root.dataset.checkoutAvailable === 'true';
    if (available && state.foreground) emit('offer_available', { current_second: state.position, is_playing: Boolean(advancing) }, 'available');
    const offer = doc.querySelector('#deal-offer-content');
    const canSee = available && !state.fullscreen && !doc.querySelector('#draftx-checkout-dialog[open]');
    if (visibleForOneSecond('offer', offer, state.wall, canSee)) {
      emit('offer_visible', { current_second: state.position }, 'offer-visible');
      const rect = offer.getBoundingClientRect();
      const depth = Math.max(0, Math.min(100, (view.innerHeight - rect.top) / Math.max(1, rect.height) * 100));
      for (const threshold of [5, 10, 25, 50, 75, 90, 100]) {
        if (depth >= threshold) emit('offer_depth', { depth_percent: threshold }, 'depth:' + threshold);
      }
    }
    for (const [section, selector] of SECTIONS) {
      if (visibleForOneSecond(section, offer?.querySelector(selector), state.wall, canSee)) emit('offer_section_visible', { section }, 'section:' + section);
    }
    const status = transport?.snapshot();
    if ((status?.dropped > lastDropped || status?.rejected > lastRejected || observerErrors > reportedErrors) && state.wall - lastDiagnosticAt >= 60000) {
      lastDiagnosticAt = state.wall; lastDropped = status?.dropped || 0;
      lastRejected = status?.rejected || 0; reportedErrors = observerErrors;
      emit('tracking_diagnostic', { reason: 'delivery_or_observer_gap', dropped_events: lastDropped, rejected_events: lastRejected, observer_errors: observerErrors, queue_length: status?.queued || 0 });
    }
    prior = state;
  });
  const onHidden = safe(() => { flushInterval(); prior = null; dwell.clear(); });
  const onPageShow = safe(() => { prior = null; tick(); });
  doc.addEventListener('click', capture, true);
  for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown']) doc.addEventListener(type, gesture, { passive: true });
  view.addEventListener('scroll', onScroll, { passive: true });
  doc.addEventListener('visibilitychange', onHidden);
  view.addEventListener('pagehide', onHidden);
  view.addEventListener('pageshow', onPageShow);
  const timer = view.setInterval(tick, 1000);
  const track = safe((name, meta = {}) => {
    if (String(root.dataset.registrationToken || '') !== token) tick();
    if (name === 'checkout_clicked') { attempt = trackingId(view); emit('checkout_opened', { ...meta, button_id: opener, checkout_attempt_id: attempt }); }
    else if (['checkout_step_viewed', 'checkout_step_completed', 'checkout_plan_selected', 'checkout_closed',
      'payment_frame_loading', 'payment_frame_visible', 'payment_frame_timeout', 'payment_frame_retry', 'payment_redirect_observed'].includes(name)) {
      emit(name, { ...meta, button_id: opener, checkout_attempt_id: attempt });
    }
  });
  track.stop = safe(() => { flushInterval(); view.clearInterval(timer); transport?.stop();
    doc.removeEventListener('click', capture, true);
    for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown']) doc.removeEventListener(type, gesture);
    view.removeEventListener('scroll', onScroll); doc.removeEventListener('visibilitychange', onHidden);
    view.removeEventListener('pagehide', onHidden); view.removeEventListener('pageshow', onPageShow);
  });
  track.status = () => ({ ...(transport?.snapshot() || { preview: true }), observerErrors });
  root.__mc2JourneyV2 = track;
  view.__mc2JourneyV2 = { schema: 2, status: track.status };
  tick();
  return track;
}
