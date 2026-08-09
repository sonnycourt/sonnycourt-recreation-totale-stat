const DELAYS = new Set([12, 24, 48, 72, 120, 168]);

function safeDelay(value, fallback) {
  const number = Number(value);
  return DELAYS.has(number) ? number : fallback;
}

export function normalizePayRecoveryPolicy(value = {}) {
  const firstDelayHours = safeDelay(value.firstDelayHours, 24);
  const followUpDelayHours = safeDelay(value.followUpDelayHours, 72);
  return {
    enabled: value.enabled === true,
    firstDelayHours,
    followUpDelayHours: Math.max(firstDelayHours, followUpDelayHours),
    maxReminders: value.maxReminders === 2 ? 2 : 1,
  };
}

export function payRecoveryEligibleRows(rows = []) {
  return rows.filter((row) => Array.isArray(row) && String(row[2] || '').includes('@'));
}

export function payRecoverySchedule(failedAt, policy = {}) {
  const normalized = normalizePayRecoveryPolicy(policy);
  const timestamp = new Date(failedAt).getTime();
  if (!Number.isFinite(timestamp)) return [];
  const dates = [new Date(timestamp + normalized.firstDelayHours * 3_600_000).toISOString()];
  if (normalized.maxReminders === 2) dates.push(new Date(timestamp + normalized.followUpDelayHours * 3_600_000).toISOString());
  return dates;
}
