import {
  MC2_SESSION_DURATION_MS,
  mc2SessionEndsAt,
} from '../../../src/lib/mc2-timing.mjs';

const QUARTER_MS = 15 * 60 * 1000;
const JIT_GRACE_MS = 3 * 60 * 1000;
const JIT_MAX_LEAD_MS = 30 * 60 * 1000;
const SCHEDULED_MIN_LEAD_MS = 45 * 60 * 1000;
const SCHEDULED_MAX_LEAD_MS = 6 * 24 * 60 * 60 * 1000;

export const MC2_SLOT_KINDS = new Set(['jit', 'scheduled']);

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.length > 80) return false;
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function isQuarterBoundary(date) {
  return date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0 && date.getUTCMinutes() % 15 === 0;
}

/**
 * Le navigateur propose les horaires, mais le serveur les contrôle toujours.
 * Cela empêche un client de fabriquer une session ou une échéance arbitraire.
 */
export function validateMc2SessionSelection({ sessionStartsAt, slotKind, visitorTimezone }, now = new Date()) {
  const kind = MC2_SLOT_KINDS.has(slotKind) ? slotKind : '';
  const timezone = isValidTimeZone(visitorTimezone) ? visitorTimezone : 'UTC';
  const start = new Date(sessionStartsAt);
  if (!kind || !Number.isFinite(start.getTime())) {
    return { ok: false, error: 'session_invalid' };
  }

  const leadMs = start.getTime() - now.getTime();
  if (kind === 'jit') {
    if (!isQuarterBoundary(start) || leadMs < -JIT_GRACE_MS || leadMs > JIT_MAX_LEAD_MS) {
      return { ok: false, error: 'jit_session_out_of_range' };
    }
  } else {
    if (leadMs < SCHEDULED_MIN_LEAD_MS || leadMs > SCHEDULED_MAX_LEAD_MS) {
      return { ok: false, error: 'scheduled_session_out_of_range' };
    }
    const local = zonedParts(start, timezone);
    if (local.minute !== 0 || local.second !== 0 || ![11, 20].includes(local.hour)) {
      return { ok: false, error: 'scheduled_session_not_allowed' };
    }
  }

  return {
    ok: true,
    slotKind: kind,
    visitorTimezone: timezone,
    sessionStartsAt: start,
    sessionEndsAt: mc2SessionEndsAt(start),
  };
}

export function mc2SessionDurationMs() {
  return MC2_SESSION_DURATION_MS;
}
