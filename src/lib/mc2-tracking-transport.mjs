// An isolated analytics queue. No player/payment calls and no awaited work on UI handlers.
const KEY = 'mc2_tracking_queue_v2';
const TTL = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 600;
const MAX_BYTES = 220000;
const ENDPOINT = '/.netlify/functions/track-mc2-journey';

export function createTrackingTransport(view, { now = () => Date.now(), random = Math.random } = {}) {
  let queue = [], timer = null, inFlight = false, failures = 0, stopped = false;
  const status = { queued: 0, acknowledged: 0, rejected: 0, dropped: 0, failures: 0, lastAckAt: null, storageAvailable: true };
  const valid = e => e && typeof e.event_id === 'string' && Number.isFinite(Date.parse(e.client_occurred_at)) && now() - Date.parse(e.client_occurred_at) < TTL;
  try { const saved = JSON.parse(view.sessionStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) queue = saved.filter(valid).slice(-MAX_EVENTS); }
  catch { status.storageAvailable = false; }
  const persist = () => {
    status.queued = queue.length;
    try { view.sessionStorage.setItem(KEY, JSON.stringify(queue)); } catch { status.storageAvailable = false; }
  };
  const trim = () => {
    const before = queue.length;
    queue = queue.filter(valid);
    status.dropped += before - queue.length;
    while (queue.length > MAX_EVENTS || JSON.stringify(queue).length > MAX_BYTES) {
      const sample = queue.findIndex(e => ['playback_interval', 'player_state'].includes(e.event_name));
      queue.splice(sample < 0 ? 0 : sample, 1); status.dropped++;
    }
    persist();
  };
  const batch = (maxBytes = 24000) => {
    const chosen = [];
    for (const event of queue) {
      if (chosen.length === 24 || JSON.stringify([...chosen, event]).length > maxBytes) break;
      chosen.push(event);
    }
    return chosen;
  };
  const schedule = (delay = 250) => {
    if (stopped || timer !== null || !queue.length || view.navigator?.onLine === false) return;
    timer = view.setTimeout(() => { timer = null; void flush(); }, delay);
  };
  const acknowledge = (data, sent) => {
    if (!Array.isArray(data?.accepted) || !Array.isArray(data?.rejected)) return false;
    const sentIds = new Set(sent.map(e => e.event_id));
    const accepted = data.accepted.filter(id => sentIds.has(id));
    const rejected = data.rejected.filter(id => sentIds.has(id));
    const ids = new Set([...accepted, ...rejected]);
    queue = queue.filter(e => !ids.has(e.event_id));
    status.acknowledged += accepted.length; status.rejected += rejected.length;
    if (accepted.length) status.lastAckAt = new Date(now()).toISOString();
    persist();
    return ids.size > 0;
  };
  const send = async (sent, keepalive = false) => {
    const controller = new AbortController();
    const timeout = view.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await view.fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_version: 2, events: sent }), signal: controller.signal,
        ...(keepalive ? { keepalive: true } : {}),
      });
      if (!response.ok) return false;
      return acknowledge(await response.json(), sent);
    } finally { view.clearTimeout(timeout); }
  };
  const flush = async () => {
    if (inFlight || stopped || view.navigator?.onLine === false) return;
    trim();
    if (!queue.length) return;
    inFlight = true;
    let ok = false;
    try { ok = await send(batch()); } catch { /* Never propagate analytics errors. */ }
    finally {
      inFlight = false;
      if (ok) failures = 0;
      else { failures++; status.failures++; }
      schedule(ok ? 250 : Math.min(30000, 1000 * 2 ** Math.min(failures, 5)) + Math.floor(random() * 500));
    }
  };
  const onOnline = () => schedule(0);
  const onHide = () => {
    // Run after the observer's pagehide handler has persisted its last interval.
    void Promise.resolve().then(() => {
      trim();
      if (queue.length && !inFlight && !stopped) return send(batch(7000), true);
    }).catch(() => {});
  };
  view.addEventListener?.('online', onOnline);
  view.addEventListener?.('pageshow', onOnline);
  view.addEventListener?.('pagehide', onHide);
  trim(); schedule();
  return {
    enqueue(event) { try { if (stopped || !valid(event)) return; queue.push(event); trim(); schedule(); } catch { status.dropped++; } },
    flush,
    snapshot: () => ({ ...status }),
    stop() { stopped = true; if (timer !== null) view.clearTimeout(timer); persist();
      view.removeEventListener?.('online', onOnline); view.removeEventListener?.('pageshow', onOnline); view.removeEventListener?.('pagehide', onHide); },
  };
}
