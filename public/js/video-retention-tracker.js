(function () {
  const scriptEl = document.currentScript;
  const videoEl = document.querySelector("video");

  if (!scriptEl || !videoEl) {
    return;
  }

  const pageId = scriptEl.dataset.retentionPageId || window.location.pathname;
  const endpoint = scriptEl.dataset.retentionEndpoint || "/api/video-retention";
  const SESSION_KEY = "video_retention_session_id";
  const sentSecondsStorageKeyPrefix = "video_retention_sent_seconds";

  function getSessionId() {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const nextId =
      (window.crypto && window.crypto.randomUUID && window.crypto.randomUUID()) ||
      `${Date.now()}_${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(SESSION_KEY, nextId);
    return nextId;
  }

  function parseStoredSeconds(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((v) => Number.isInteger(v) && v >= 0));
    } catch (_error) {
      return new Set();
    }
  }

  function persistSeconds(key, values) {
    localStorage.setItem(key, JSON.stringify(Array.from(values).sort((a, b) => a - b)));
  }

  const sessionId = getSessionId();
  const sentSecondsStorageKey = `${sentSecondsStorageKeyPrefix}:${pageId}:${sessionId}`;
  const sentSeconds = parseStoredSeconds(sentSecondsStorageKey);
  const pendingSeconds = new Set();
  let isFlushing = false;
  let flushQueued = false;

  function trackCurrentSecond() {
    const second = Math.floor(videoEl.currentTime || 0);
    if (!Number.isInteger(second) || second < 0) return;
    if (sentSeconds.has(second)) return;
    pendingSeconds.add(second);
  }

  function buildPayload(seconds) {
    return {
      video_id: pageId,
      session_id: sessionId,
      seconds,
    };
  }

  function tryBeacon(payload) {
    if (!navigator.sendBeacon) return false;
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    return navigator.sendBeacon(endpoint, blob);
  }

  async function flushPendingSeconds(useBeacon) {
    if (pendingSeconds.size === 0) return;
    if (isFlushing) {
      flushQueued = true;
      return;
    }

    const seconds = Array.from(pendingSeconds).sort((a, b) => a - b);
    pendingSeconds.clear();
    seconds.forEach((s) => sentSeconds.add(s));
    persistSeconds(sentSecondsStorageKey, sentSeconds);

    const payload = buildPayload(seconds);

    if (useBeacon && tryBeacon(payload)) {
      return;
    }

    isFlushing = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Retention flush failed");
      }
    } catch (_error) {
      // Restore unsent seconds so a later event can retry.
      seconds.forEach((s) => {
        sentSeconds.delete(s);
        pendingSeconds.add(s);
      });
      persistSeconds(sentSecondsStorageKey, sentSeconds);
    } finally {
      isFlushing = false;
      if (flushQueued) {
        flushQueued = false;
        flushPendingSeconds(false);
      }
    }
  }

  videoEl.addEventListener("timeupdate", trackCurrentSecond);
  videoEl.addEventListener("pause", function () {
    trackCurrentSecond();
    flushPendingSeconds(false);
  });
  videoEl.addEventListener("ended", function () {
    trackCurrentSecond();
    flushPendingSeconds(false);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      trackCurrentSecond();
      flushPendingSeconds(true);
    }
  });

  window.addEventListener("pagehide", function () {
    trackCurrentSecond();
    flushPendingSeconds(true);
  });

  window.addEventListener("beforeunload", function () {
    trackCurrentSecond();
    flushPendingSeconds(true);
  });
})();
