import { TOTAL_SEATS, WEEKLY_TIMELINE, type Purchase } from '../data/scarcity-timeline';

type WindowPhase = 'upcoming' | 'active' | 'closed';

export type ScarcityWindow = {
  startMs: number;
  endMs: number;
  phase: WindowPhase;
};

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

export function getSoldCount(nowMs = Date.now()): number {
  const win = getCurrentWindow(nowMs);
  if (nowMs < win.startMs) return 0;
  if (nowMs >= win.endMs) return TOTAL_SEATS;
  const elapsed = nowMs - win.startMs;
  return WEEKLY_TIMELINE.filter((p) => p.offsetMs <= elapsed).length;
}

export function getSeatsLeft(nowMs = Date.now()): number {
  return Math.max(0, TOTAL_SEATS - getSoldCount(nowMs));
}

export function getNextScheduledPurchase(nowMs = Date.now()): Purchase | null {
  const win = getCurrentWindow(nowMs);
  if (nowMs < win.startMs) return WEEKLY_TIMELINE[0] || null;
  if (nowMs >= win.endMs) return null;
  const elapsed = nowMs - win.startMs;
  return WEEKLY_TIMELINE.find((p) => p.offsetMs > elapsed) || null;
}

export function getAlreadySoldPool(nowMs = Date.now()): Purchase[] {
  const sold = getSoldCount(nowMs);
  return WEEKLY_TIMELINE.slice(0, sold);
}

type EngineOptions = {
  now?: () => number;
  isActive?: () => boolean;
  onSeatsLeft?: (seatsLeft: number, soldCount: number) => void;
  onNotification?: (purchase: Purchase, mode: 'timeline' | 'replay') => void;
  debug?: boolean;
};

export function startScarcityEngine(options: EngineOptions = {}) {
  const now = options.now || (() => Date.now());
  const isActive = options.isActive || (() => true);
  const onSeatsLeft = options.onSeatsLeft || (() => {});
  const onNotification = options.onNotification || (() => {});
  const debug = Boolean(options.debug);

  let timer: ReturnType<typeof setInterval> | null = null;
  let nextReplayAt = 0;
  let emittedTimelineCount = getSoldCount(now());
  let lastReplayName = '';
  let lastSeatPushSec = -1;

  function log(...args: unknown[]) {
    if (debug) console.log('[scarcity]', ...args);
  }

  function scheduleReplay(nowMs: number) {
    const jitter = 12_000 + Math.random() * 6_000; // 12-18s
    nextReplayAt = nowMs + Math.floor(jitter);
  }

  function emitReplay(nowMs: number) {
    const pool = getAlreadySoldPool(nowMs);
    if (!pool.length) return;
    const candidates = pool.filter((p) => p.name !== lastReplayName);
    const src = candidates.length ? candidates : pool;
    const picked = src[Math.floor(Math.random() * src.length)];
    if (!picked) return;
    lastReplayName = picked.name;
    onNotification(picked, 'replay');
  }

  function tick() {
    const nowMs = now();
    const win = getCurrentWindow(nowMs);
    const active = isActive() && win.phase === 'active';
    const soldCount = getSoldCount(nowMs);
    const seatsLeft = Math.max(0, TOTAL_SEATS - soldCount);

    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec !== lastSeatPushSec) {
      lastSeatPushSec = nowSec;
      onSeatsLeft(seatsLeft, soldCount);
    }

    if (!active) {
      nextReplayAt = 0;
      emittedTimelineCount = soldCount;
      return;
    }

    if (soldCount > emittedTimelineCount) {
      const latest = WEEKLY_TIMELINE[soldCount - 1];
      if (latest) {
        lastReplayName = latest.name;
        onNotification(latest, 'timeline');
        log('timeline emit', latest.name, `sold=${soldCount}`);
      }
      emittedTimelineCount = soldCount;
      scheduleReplay(nowMs);
      return;
    }

    if (!nextReplayAt) scheduleReplay(nowMs);
    if (nowMs >= nextReplayAt) {
      emitReplay(nowMs);
      log('replay emit', `sold=${soldCount}`, `seats=${seatsLeft}`);
      scheduleReplay(nowMs);
    }
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
      return {
        nowMs: n,
        window: getCurrentWindow(n),
        soldCount: getSoldCount(n),
        seatsLeft: getSeatsLeft(n),
        next: getNextScheduledPurchase(n),
        pool: getAlreadySoldPool(n).map((p) => p.name),
      };
    },
  };
}

