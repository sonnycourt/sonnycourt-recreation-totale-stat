const ACTIVE_WINDOW_MS = 90 * 1000;

function stamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function int(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function purchased(row) {
  return Boolean(row?.purchased_at)
    || row?.statut === 'purchased'
    || ['paid', 'succeeded', 'active', 'complete', 'completed']
      .includes(String(row?.payment_status || '').toLowerCase());
}

function completed(row) {
  return Boolean(row?.registration_completed_at)
    || !['', 'partial'].includes(String(row?.statut || ''));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function registrationMap(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const token = String(row?.token || '').trim();
    if (token && !map.has(token)) map.set(token, row);
  }
  return map;
}

export function summarizeMc2Cockpit({
  presenceRows = [],
  recentRegistrations = [],
  scheduledRegistrations = [],
  checkoutActuallySeenEvents = [],
  now = new Date(),
} = {}) {
  const nowMs = now.getTime();
  const activeCutoff = nowMs - ACTIVE_WINDOW_MS;
  const active = presenceRows.filter((row) => (stamp(row?.updated_at) || 0) >= activeCutoff);
  const real = active.filter((row) => String(row?.mode || 'real') !== 'test');
  const tests = active.filter((row) => String(row?.mode || '') === 'test');
  const playingSession = real.filter((row) => row?.stage === 'session' && row?.is_playing === true);
  const playingReplay = real.filter((row) => row?.stage === 'replay' && row?.is_playing === true);
  const waiting = real.filter((row) => row?.stage === 'waiting');

  const recentMap = registrationMap(recentRegistrations);
  const scheduledMap = registrationMap(scheduledRegistrations);
  const allMap = new Map([...recentMap, ...scheduledMap]);
  const activeJit = real.filter((row) => allMap.get(String(row?.token || ''))?.slot_kind === 'jit');
  const activeScheduled = real.filter((row) => allMap.get(String(row?.token || ''))?.slot_kind === 'scheduled');
  const activeUnclassified = Math.max(0, real.length - activeJit.length - activeScheduled.length);

  const recentComplete = recentRegistrations.filter(completed);
  const recentCompleteTokens = new Set(
    recentComplete.map((row) => String(row?.token || '').trim()).filter(Boolean),
  );
  const checkoutActuallySeenTokens = new Set(
    checkoutActuallySeenEvents
      .map((row) => String(row?.token || '').trim())
      .filter((token) => token && recentCompleteTokens.has(token)),
  );
  const funnel24h = {
    registrations: recentComplete.length,
    attended: recentComplete.filter((row) => row?.attended_live === true
      || int(row?.watch_max_seconds_live) > 0
      || int(row?.watch_max_seconds_replay) > 0).length,
    offer: recentComplete.filter((row) => row?.saw_offer === true).length,
    checkout: recentComplete.filter((row) => int(row?.checkout_view_count) > 0
      || row?.checkout_clicked === true
      || row?.checkout_engaged === true).length,
    checkoutActuallySeen: checkoutActuallySeenTokens.size,
    checkoutEngaged: recentComplete.filter((row) => row?.checkout_engaged === true).length,
    purchases: recentComplete.filter(purchased).length,
  };

  const activeByToken = new Map(real.map((row) => [String(row?.token || ''), row]));
  const grouped = new Map();
  for (const row of scheduledRegistrations.filter(completed)) {
    const startsMs = stamp(row?.session_starts_at);
    const endsMs = stamp(row?.session_ends_at);
    if (startsMs == null || endsMs == null || endsMs < nowMs) continue;
    const key = new Date(startsMs).toISOString();
    if (!grouped.has(key)) {
      grouped.set(key, {
        startsAt: key,
        endsAt: new Date(endsMs).toISOString(),
        registrations: 0,
        waitingNow: 0,
        watchingNow: 0,
      });
    }
    const item = grouped.get(key);
    item.registrations += 1;
    const presence = activeByToken.get(String(row?.token || ''));
    if (presence?.stage === 'waiting') item.waitingNow += 1;
    if (presence?.stage === 'session' && presence?.is_playing === true) item.watchingNow += 1;
  }

  const lastSignalMs = real
    .map((row) => stamp(row?.updated_at))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || null;

  return {
    readOnly: true,
    generatedAt: now.toISOString(),
    presence: {
      waiting: waiting.length,
      watchingSession: playingSession.length,
      watchingReplay: playingReplay.length,
      activeTotal: real.length,
      activeJit: activeJit.length,
      activeScheduled: activeScheduled.length,
      activeUnclassified,
      tests: tests.length,
      sessionMedianSecond: median(playingSession.map((row) => int(row?.current_second))),
      replayMedianSecond: median(playingReplay.map((row) => int(row?.current_second))),
      lastSignalAt: lastSignalMs == null ? null : new Date(lastSignalMs).toISOString(),
    },
    funnel24h,
    scheduledSessions: Array.from(grouped.values())
      .sort((a, b) => stamp(a.startsAt) - stamp(b.startsAt))
      .slice(0, 12),
  };
}

export { ACTIVE_WINDOW_MS };
