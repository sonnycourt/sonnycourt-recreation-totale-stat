// A browser fallback for this registration AND this scheduled session only.
// It is written after actual playback, never on a page view or metadata load.
const storageKey = token => 'mc2_live_participation_v1_' + token;

export function hasMc2LiveParticipation({ storage, token, sessionStartMs, liveStartMs, broadcastEndMs, nowMs }) {
  if (!token || ![sessionStartMs, liveStartMs, broadcastEndMs, nowMs].every(Number.isFinite)) return false;
  try {
    const saved = JSON.parse(storage.getItem(storageKey(token)) || 'null');
    return saved?.sessionStartMs === sessionStartMs
      && Number.isFinite(saved.joinedAtMs)
      && saved.joinedAtMs >= liveStartMs
      && saved.joinedAtMs < broadcastEndMs
      && saved.joinedAtMs <= nowMs;
  } catch {
    return false;
  }
}

// Only session_joined is retried. The existing server endpoint deduplicates it.
export function createMc2LiveParticipation({
  storage, token, sessionStartMs, participated = false, acknowledged = false,
  send, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let stopped = false;
  let inFlight = false;
  let retryTimer = null;
  let requestTimer = null;
  let controller = null;
  let failures = 0;
  const retryDelays = [2000, 5000, 15000, 30000];

  async function retry() {
    if (stopped || acknowledged || !participated || inFlight || retryTimer !== null) return;
    inFlight = true;
    controller = new AbortController();
    const signal = controller.signal;
    // Even a request that never returns must not permanently suppress presence.
    const aborted = new Promise(resolve => signal.addEventListener('abort', () => resolve(null), { once: true }));
    requestTimer = setTimer(() => controller?.abort(), 10000);
    let result = null;
    try {
      result = await Promise.race([Promise.resolve().then(() => send(signal)), aborted]);
    } catch {
      // Transient network/server errors are retried without interrupting playback.
    } finally {
      clearTimer(requestTimer);
      requestTimer = null;
      controller = null;
      inFlight = false;
    }
    if (stopped) return;
    if (result?.ok === true) {
      acknowledged = true;
      return;
    }
    const delay = retryDelays[Math.min(failures++, retryDelays.length - 1)];
    retryTimer = setTimer(() => {
      retryTimer = null;
      void retry();
    }, delay);
  }

  return {
    confirmPlayback() {
      if (stopped || !token || !Number.isFinite(sessionStartMs)) return;
      if (!participated) {
        participated = true;
        // Persist BEFORE the request: a refresh while it is pending is safe too.
        try {
          storage.setItem(storageKey(token), JSON.stringify({ sessionStartMs, joinedAtMs: now() }));
        } catch {
          // Server acknowledgement/retries still work with storage disabled.
        }
      }
      void retry();
    },
    retry,
    destroy() {
      stopped = true;
      clearTimer(retryTimer);
      clearTimer(requestTimer);
      controller?.abort();
    },
  };
}
