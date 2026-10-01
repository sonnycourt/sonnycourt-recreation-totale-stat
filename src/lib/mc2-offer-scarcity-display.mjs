// Affiche le résultat serveur. Ne contient ni la cadence, ni la liste des achats.

const ENDPOINT = '/.netlify/functions/mc2-offer-scarcity';
const MAX_POLL_MS = 15 * 1000;
const MIN_POLL_MS = 400;
const FRESH_PREFETCH_MS = 3000;
const prefetches = new Map();

function prefetchKey(windowStartMs, windowEndMs) {
  return `${windowStartMs}:${windowEndMs}`;
}

function requestScarcity({ windowStartMs, windowEndMs, nowMs, seenSoldCount }) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      windowStartMs,
      windowEndMs,
      nowMs,
      seenSoldCount,
    }),
  }).then((response) => (response.ok ? response.json() : null)).catch(() => null);
}

export function prefetchMc2OfferScarcity({ windowStartMs, windowEndMs, nowMs } = {}) {
  const start = Number(windowStartMs);
  const end = Number(windowEndMs);
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return Promise.resolve(null);
  const key = prefetchKey(start, end);
  const current = prefetches.get(key);
  if (current && Date.now() - current.startedAt < FRESH_PREFETCH_MS) return current.promise;
  const entry = { startedAt: Date.now(), data: null, promise: null };
  entry.promise = requestScarcity({
    windowStartMs: start,
    windowEndMs: end,
    nowMs: now,
    seenSoldCount: null,
  }).then((data) => {
    entry.data = data;
    return data;
  });
  prefetches.set(key, entry);
  return entry.promise;
}

function freshPrefetch(windowStartMs, windowEndMs) {
  const entry = prefetches.get(prefetchKey(windowStartMs, windowEndMs));
  if (!entry || Date.now() - entry.startedAt > FRESH_PREFETCH_MS) return null;
  return entry;
}

export function startMc2OfferScarcityDisplay(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
  const onSeatsLeft = typeof options.onSeatsLeft === 'function' ? options.onSeatsLeft : () => {};
  const onNotification = typeof options.onNotification === 'function' ? options.onNotification : () => {};
  const windowStartMs = Number(options.windowStartMs);
  const windowEndMs = Number(options.windowEndMs);

  let stopped = false;
  let timer = null;
  let dripTimer = null;
  let refreshing = false;
  let queued = false;
  let requestSerial = 0;
  let baselineReady = false;
  let seenSoldCount = null;
  let snapshot = null;
  let readySettled = false;
  let resolveReady = () => {};
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const queue = [];

  function settleReady() {
    if (readySettled) return;
    readySettled = true;
    resolveReady();
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function getRemainingSeconds() {
    if (!snapshot) return null;
    const drift = now() - snapshot.evaluatedNowMs;
    return Math.max(0, Math.ceil((snapshot.remainingMs - drift) / 1000));
  }

  function pump() {
    if (dripTimer || stopped) return;
    if (!isActive()) {
      queue.length = 0;
      return;
    }
    const purchase = queue.shift();
    if (!purchase) return;
    onNotification(purchase);
    dripTimer = setTimeout(() => {
      dripTimer = null;
      pump();
    }, 1000);
  }

  function applySnapshot(data) {
    snapshot = {
      evaluatedNowMs: Number(data.evaluatedNowMs),
      remainingMs: Number(data.remainingMs),
      seatsLeft: Number(data.seatsLeft) || 0,
      soldCount: Number(data.soldCount) || 0,
      phase: data.phase || 'phase1',
      nextChangeInMs: Number.isFinite(Number(data.nextChangeInMs)) ? Number(data.nextChangeInMs) : null,
    };
    onSeatsLeft(snapshot.seatsLeft, snapshot.soldCount, snapshot.phase);
    settleReady();
    const active = isActive();
    if (!baselineReady) {
      seenSoldCount = snapshot.soldCount;
      baselineReady = true;
      queue.length = 0;
      return;
    }
    if (!active || snapshot.soldCount < seenSoldCount) {
      seenSoldCount = snapshot.soldCount;
      queue.length = 0;
      return;
    }
    const purchases = Array.isArray(data.purchases) ? data.purchases : [];
    if (purchases.length) {
      queue.push(...purchases.filter((purchase) => purchase && purchase.name && purchase.flag));
      seenSoldCount = snapshot.soldCount;
      pump();
      return;
    }
    seenSoldCount = snapshot.soldCount;
  }

  async function refresh() {
    if (stopped) return;
    if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs <= windowStartMs) return;
    const serial = ++requestSerial;
    try {
      const pending = !snapshot ? freshPrefetch(windowStartMs, windowEndMs) : null;
      const data = pending
        ? await pending.promise
        : await requestScarcity({
          windowStartMs,
          windowEndMs,
          nowMs: now(),
          seenSoldCount,
        });
      if (serial !== requestSerial || stopped || !data) {
        settleReady();
        return;
      }
      applySnapshot(data);
    } catch {
      settleReady();
    }
  }

  function delayMs() {
    if (!snapshot || !Number.isFinite(snapshot.nextChangeInMs)) return MAX_POLL_MS;
    return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, snapshot.nextChangeInMs + 40));
  }

  function arm() {
    clearTimer();
    if (stopped) return;
    timer = setTimeout(() => { void poll(); }, delayMs());
  }

  async function poll() {
    if (stopped) return;
    if (refreshing) {
      queued = true;
      return;
    }
    refreshing = true;
    try {
      await refresh();
    } finally {
      refreshing = false;
      if (stopped) return;
      if (queued) {
        queued = false;
        void poll();
        return;
      }
      arm();
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible') void poll();
  }

  document.addEventListener('visibilitychange', onVisible);
  const pending = freshPrefetch(windowStartMs, windowEndMs);
  if (pending?.data) applySnapshot(pending.data);
  void poll();

  return {
    ready,
    hasSnapshot() { return Boolean(snapshot); },
    stop() {
      stopped = true;
      requestSerial += 1;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisible);
      if (dripTimer) clearTimeout(dripTimer);
      dripTimer = null;
      queue.length = 0;
    },
    recalc() {
      requestSerial += 1;
      clearTimer();
      void poll();
    },
    getRemainingSeconds,
    debugSnapshot() {
      if (!snapshot) return null;
      return {
        nowMs: now(),
        phase: snapshot.phase,
        soldCount: snapshot.soldCount,
        seatsLeft: snapshot.seatsLeft,
        remainingMs: Math.max(0, snapshot.remainingMs - (now() - snapshot.evaluatedNowMs)),
      };
    },
  };
}
