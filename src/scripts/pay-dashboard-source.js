const DAY_MS = 86_400_000;

function timestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric * 1_000 : null;
}

export function canUseStripePreview(overview, transactions, start, end) {
  if (!overview?.connected || !Array.isArray(transactions)) return false;
  const window = overview.transaction_window;
  if (!window || window.truncated) return false;
  const from = timestamp(window.since);
  const until = timestamp(window.until);
  const startAt = start instanceof Date ? start.getTime() : Number.NaN;
  const endAt = end instanceof Date ? end.getTime() : Number.NaN;
  return Boolean(from && until && Number.isFinite(startAt) && Number.isFinite(endAt) && startAt >= from && endAt <= until && endAt - startAt <= 366 * DAY_MS);
}

export function createDashboardDay(date, { liveReady = false, historyReady = false } = {}) {
  return {
    date,
    revenue: liveReady ? 0 : null,
    refunds: liveReady ? 0 : null,
    refundCount: liveReady ? 0 : null,
    orders: historyReady ? 0 : null,
    plans: historyReady ? 0 : null,
    pastDue: historyReady ? 0 : null,
  };
}
