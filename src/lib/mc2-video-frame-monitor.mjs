// Observe delivered video frames, NOT pixel changes: a static slide is healthy.
// This supplements the existing buffering watchdog; unsupported browsers keep it.
export function createMc2VideoFrameMonitor(video, {
  onFrozen,
  isEligible = () => true,
  document: doc = globalThis.document,
  now = () => performance.now(),
  setInterval: schedule = globalThis.setInterval,
  clearInterval: unschedule = globalThis.clearInterval,
  thresholdMs = 5000,
  graceMs = 3000,
} = {}) {
  let stopped = false;
  let frames = 0;
  let callbackId = null;
  let timer = null;
  let active = false;
  let latched = false;
  let lastFrameAt = now();
  let lastPollAt = lastFrameAt;
  let graceUntil = lastFrameAt + graceMs;
  let lastTime = Number(video?.currentTime) || 0;
  let progressWithoutFramesMs = 0;
  let sampledFrames = 0;
  const supported = typeof video?.requestVideoFrameCallback === 'function'
    && typeof video?.cancelVideoFrameCallback === 'function';

  const reset = () => {
    const at = now();
    active = false;
    lastFrameAt = lastPollAt = at;
    graceUntil = at + graceMs;
    lastTime = Number(video?.currentTime) || 0;
    progressWithoutFramesMs = 0;
    sampledFrames = frames;
  };
  const visible = () => {
    if (doc?.visibilityState === 'hidden') return false;
    if (doc?.pictureInPictureElement === video) return true;
    if (typeof video.getBoundingClientRect !== 'function') return true;
    const rect = video.getBoundingClientRect();
    const view = doc?.defaultView;
    // Off-screen video can legitimately stop submitting frames while audio plays.
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && (!view || (rect.top < view.innerHeight && rect.left < view.innerWidth));
  };
  function poll() {
    if (stopped) return;
    const at = now();
    const elapsed = at - lastPollAt;
    if (!isEligible() || !visible() || video.paused || video.ended || video.seeking || video.readyState < 2
      || elapsed < 0 || elapsed > 2000) {
      reset();
      return;
    }
    const current = Number(video.currentTime) || 0;
    if (!active) {
      reset();
      active = true;
    }
    lastPollAt = at;
    const advance = current - lastTime;
    lastTime = current;
    if (frames !== sampledFrames) {
      sampledFrames = frames;
      progressWithoutFramesMs = 0;
      latched = false;
    }
    // Ignore seeks/discontinuities and leave ordinary buffering to the old watchdog.
    if (advance <= 0 || advance > elapsed / 1000 * 1.5 + 0.25) {
      progressWithoutFramesMs = 0;
      return;
    }
    if (at < graceUntil) return;
    progressWithoutFramesMs += elapsed;
    if (!latched && at - lastFrameAt >= thresholdMs && progressWithoutFramesMs >= thresholdMs) {
      latched = true;
      // Failure in supplementary monitoring must never interrupt normal playback.
      try { Promise.resolve(onFrozen?.({ frames, stalledMs: at - lastFrameAt })).catch(() => {}); } catch {}
    }
  }
  function onFrame() {
    if (stopped) return;
    frames++;
    lastFrameAt = now();
    try { callbackId = video.requestVideoFrameCallback(onFrame); } catch { destroy(); }
  }
  function destroy() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) unschedule(timer);
    if (callbackId !== null) {
      try { video.cancelVideoFrameCallback(callbackId); } catch {}
    }
    for (const event of ['playing', 'pause', 'seeking', 'seeked', 'loadedmetadata', 'emptied']) {
      video?.removeEventListener?.(event, reset);
    }
    doc?.removeEventListener?.('visibilitychange', reset);
  }
  if (supported) {
    try {
      callbackId = video.requestVideoFrameCallback(onFrame);
      timer = schedule(poll, 500);
      for (const event of ['playing', 'pause', 'seeking', 'seeked', 'loadedmetadata', 'emptied']) {
        video.addEventListener(event, reset);
      }
      doc?.addEventListener?.('visibilitychange', reset);
    } catch { destroy(); }
  }
  return { supported, frameCount: () => frames, isVisible: visible, reset, destroy };
}
