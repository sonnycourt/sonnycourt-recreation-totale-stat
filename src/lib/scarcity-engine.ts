import {
  PHASE1_SEATS,
  PHASE2_SEATS,
  PHASE2_START_OFFSET,
  TOTAL_SEATS,
  WEEKLY_TIMELINE,
  type Purchase,
} from '../data/scarcity-timeline';

type WindowPhase = 'upcoming' | 'active' | 'closed';

export type ScarcityWindow = {
  startMs: number;
  endMs: number;
  phase: WindowPhase;
};

export type ScarcityPhase = 'phase1' | 'sold_out' | 'phase2';
export type ScarcityWindowBounds = { startMs: number; endMs: number };
export const SCARCITY_WINDOW_START_AFTER_SESSION_MS = (66 * 60 + 6) * 1000; // 21:06:06 if session starts at 20:00

const TZ = 'Europe/Paris';
const DAY_MS = 24 * 60 * 60 * 1000;
const THURSDAY_INDEX = 4; // Sun=0 ... Thu=4

function parseGmtOffsetMinutes(label: string): number {
  const m = label.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hh = Number(m[2] || 0);
  const mm = Number(m[3] || 0);
  return sign * (hh * 60 + mm);
}

function getTzOffsetMinutes(ms: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+0';
  return parseGmtOffsetMinutes(name);
}

function parisLocalToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMin = getTzOffsetMinutes(approxUtc, TZ);
  return approxUtc - offsetMin * 60 * 1000;
}

function getParisYmd(nowMs: number): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const year = Number(parts.find((p) => p.type === 'year')?.value || 0);
  const month = Number(parts.find((p) => p.type === 'month')?.value || 0);
  const day = Number(parts.find((p) => p.type === 'day')?.value || 0);
  return { year, month, day };
}

function getParisWeekday(nowMs: number): number {
  const w = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
  }).format(new Date(nowMs));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[w] ?? 0;
}

function addYmdDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function getWindowBoundsForThursdayYmd(year: number, month: number, day: number) {
  const startMs = parisLocalToUtcMs(year, month, day, 21, 7, 12);
  const sun = addYmdDays(year, month, day, 3);
  const endMs = parisLocalToUtcMs(sun.year, sun.month, sun.day, 23, 0, 0);
  return { startMs, endMs };
}

export function getCurrentWindow(nowMs = Date.now()): ScarcityWindow {
  const { year, month, day } = getParisYmd(nowMs);
  const weekday = getParisWeekday(nowMs);
  const daysFromThursday = (weekday - THURSDAY_INDEX + 7) % 7;
  const thisThu = addYmdDays(year, month, day, -daysFromThursday);
  const thisWin = getWindowBoundsForThursdayYmd(thisThu.year, thisThu.month, thisThu.day);

  if (nowMs < thisWin.startMs) {
    return { ...thisWin, phase: 'upcoming' };
  }
  if (nowMs >= thisWin.endMs) {
    return { ...thisWin, phase: 'closed' };
  }
  return { ...thisWin, phase: 'active' };
}

function resolveWindow(nowMs: number, bounds?: ScarcityWindowBounds | null): ScarcityWindow {
  if (bounds && Number.isFinite(bounds.startMs) && Number.isFinite(bounds.endMs) && bounds.endMs > bounds.startMs) {
    if (nowMs < bounds.startMs) return { ...bounds, phase: 'upcoming' };
    if (nowMs >= bounds.endMs) return { ...bounds, phase: 'closed' };
    return { ...bounds, phase: 'active' };
  }
  return getCurrentWindow(nowMs);
}

export function getSoldCount(nowMs = Date.now(), bounds?: ScarcityWindowBounds | null): number {
  const win = resolveWindow(nowMs, bounds);
  if (nowMs < win.startMs) return 0;
  if (nowMs >= win.endMs) return TOTAL_SEATS;
  const elapsed = nowMs - win.startMs;
  return WEEKLY_TIMELINE.filter((p) => p.offsetMs <= elapsed).length;
}

export function getSeatsLeft(nowMs = Date.now(), bounds?: ScarcityWindowBounds | null): number {
  const win = resolveWindow(nowMs, bounds);
  const elapsed = nowMs - win.startMs;
  const sold = getSoldCount(nowMs, bounds);
  if (sold <= PHASE1_SEATS) {
    // Phase 2 reopens a fresh batch right after the sold-out gap.
    if (sold === PHASE1_SEATS && elapsed >= PHASE2_START_OFFSET) {
      return PHASE2_SEATS;
    }
    return Math.max(0, PHASE1_SEATS - sold);
  }
  return Math.max(0, PHASE2_SEATS - (sold - PHASE1_SEATS));
}

export function getPhase(nowMs = Date.now(), bounds?: ScarcityWindowBounds | null): ScarcityPhase {
  const win = resolveWindow(nowMs, bounds);
  if (nowMs < win.startMs) return 'phase1';

  const sold = getSoldCount(nowMs, bounds);
  const elapsed = nowMs - win.startMs;

  if (sold < PHASE1_SEATS) return 'phase1';
  if (sold >= TOTAL_SEATS) return 'sold_out';
  if (sold === PHASE1_SEATS && elapsed < PHASE2_START_OFFSET) return 'sold_out';
  if (sold >= PHASE1_SEATS && elapsed >= PHASE2_START_OFFSET) return 'phase2';
  return 'sold_out';
}

export function getNextScheduledPurchase(nowMs = Date.now(), bounds?: ScarcityWindowBounds | null): Purchase | null {
  const win = resolveWindow(nowMs, bounds);
  if (nowMs < win.startMs) return WEEKLY_TIMELINE[0] || null;
  if (nowMs >= win.endMs) return null;
  const elapsed = nowMs - win.startMs;
  return WEEKLY_TIMELINE.find((p) => p.offsetMs > elapsed) || null;
}

type EngineOptions = {
  now?: () => number;
  isActive?: () => boolean;
  windowStartMs?: number;
  windowEndMs?: number;
  onSeatsLeft?: (seatsLeft: number, soldCount: number, phase: ScarcityPhase) => void;
  onNotification?: (purchase: Purchase, mode: 'timeline' | 'replay', detail?: string) => void;
  enableReplay?: boolean;
  debug?: boolean;
};

export function startScarcityEngine(options: EngineOptions = {}) {
  const now = options.now || (() => Date.now());
  const isActive = options.isActive || (() => true);
  const onSeatsLeft = options.onSeatsLeft || (() => {});
  const onNotification = options.onNotification || (() => {});
  const enableReplay = Boolean(options.enableReplay);
  const debug = Boolean(options.debug);
  const windowBounds = (Number.isFinite(options.windowStartMs) && Number.isFinite(options.windowEndMs) && Number(options.windowEndMs) > Number(options.windowStartMs))
    ? { startMs: Number(options.windowStartMs), endMs: Number(options.windowEndMs) }
    : null;

  let timer: ReturnType<typeof setInterval> | null = null;
  let emittedTimelineCount = getSoldCount(now(), windowBounds);
  let lastSeatPushSec = -1;
  let lastReplayName = '';
  let lastTimelineName = '';
  let nextReplayAt = 0;

  function log(...args: unknown[]) {
    if (debug) console.log('[scarcity]', ...args);
  }

  function formatReplayRelative(nowMs: number, purchaseOffsetMs: number, windowStartMs: number): string {
    const diffMs = Math.max(0, nowMs - (windowStartMs + purchaseOffsetMs));
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 2) return 'quelques instants';
    if (diffMin < 60) {
      const rounded = Math.max(5, Math.round(diffMin / 5) * 5);
      return `${rounded} min`;
    }
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    return diffD <= 1 ? '1 jour' : `${diffD} jours`;
  }

  function replayDelayMs(seatsLeft: number): number {
    if (seatsLeft <= 5) return 20_000 + Math.floor(Math.random() * 10_000); // 20-30s
    return 30_000 + Math.floor(Math.random() * 15_000); // 30-45s
  }

  function scheduleReplay(nowMs: number, seatsLeft: number, initial = false) {
    if (initial) {
      nextReplayAt = nowMs + 5_000 + Math.floor(Math.random() * 5_000); // 5-10s after refresh
      return;
    }
    nextReplayAt = nowMs + replayDelayMs(seatsLeft);
  }

  function tick() {
    const nowMs = now();
    const win = resolveWindow(nowMs, windowBounds);
    const active = isActive() && win.phase === 'active';
    const soldCount = getSoldCount(nowMs, windowBounds);
    const seatsLeft = getSeatsLeft(nowMs, windowBounds);
    const phase = getPhase(nowMs, windowBounds);

    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec !== lastSeatPushSec) {
      lastSeatPushSec = nowSec;
      onSeatsLeft(seatsLeft, soldCount, phase);
    }

    if (!active) {
      emittedTimelineCount = soldCount;
      nextReplayAt = 0;
      lastReplayName = '';
      lastTimelineName = '';
      return;
    }

    if (soldCount > emittedTimelineCount) {
      // Emit one purchase at a time in order. No replay.
      const nextIdx = emittedTimelineCount;
      const nextPurchase = WEEKLY_TIMELINE[nextIdx];
      if (nextPurchase) {
        onNotification(nextPurchase, 'timeline');
        lastTimelineName = nextPurchase.name;
        log('timeline emit', nextPurchase.name, `sold=${soldCount}`);
        emittedTimelineCount += 1;
      }
      return;
    }

    // Replay mode is opt-in (for invitation only).
    if (!enableReplay) return;
    if (soldCount < 10 || soldCount >= TOTAL_SEATS) {
      nextReplayAt = 0;
      return;
    }

    if (!nextReplayAt) scheduleReplay(nowMs, seatsLeft, true);
    if (nowMs < nextReplayAt) return;

    const soldPool = WEEKLY_TIMELINE.slice(0, soldCount);
    const filtered = soldPool.filter((p) => p.name !== lastReplayName && p.name !== lastTimelineName);
    const candidates = filtered.length ? filtered : soldPool.filter((p) => p.name !== lastReplayName);
    if (!candidates.length) {
      scheduleReplay(nowMs, seatsLeft);
      return;
    }
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    if (!picked) {
      scheduleReplay(nowMs, seatsLeft);
      return;
    }
    const relative = formatReplayRelative(nowMs, picked.offsetMs, win.startMs);
    onNotification(picked, 'replay', relative);
    lastReplayName = picked.name;
    log('replay emit', picked.name, relative, `sold=${soldCount}`);
    scheduleReplay(nowMs, seatsLeft);
  }

  tick();
  timer = setInterval(tick, 1000);

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    debugSnapshot() {
      const n = now();
      const win = resolveWindow(n, windowBounds);
      const soldCountNow = getSoldCount(n, windowBounds);
      return {
        nowMs: n,
        window: win,
        phase: getPhase(n, windowBounds),
        soldCount: soldCountNow,
        seatsLeft: getSeatsLeft(n, windowBounds),
        next: getNextScheduledPurchase(n, windowBounds),
        replayEnabled: enableReplay,
        replayEligible: enableReplay && soldCountNow >= 10 && soldCountNow < TOTAL_SEATS,
        nextReplayAt,
      };
    }
  };
}

