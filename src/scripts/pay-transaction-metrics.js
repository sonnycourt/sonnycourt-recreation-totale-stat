function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function provider(value) {
  return String(value || '').trim().toLowerCase() || 'unknown';
}

export function payTransactionProviderLabel(value) {
  const normalized = provider(value);
  if (normalized === 'paypal') return 'PayPal';
  if (normalized === 'spiffy') return 'Historique Spiffy';
  if (normalized === 'internal') return 'Pay';
  return 'Stripe';
}

export function payTransactionMetrics(items = [], options = {}) {
  const currency = String(options.currency || 'eur').trim().toLowerCase();
  const cutoff = Number(options.cutoff || 0);
  const rows = (Array.isArray(items) ? items : []).filter((item) => amount(item.created) >= cutoff);
  const successful = rows.filter((item) => item.status === 'Réussi' && item.kind !== 'refund');
  const pending = rows.filter((item) => ['En attente', 'Action requise', 'Incomplet'].includes(item.status));
  const explicitRefundReferences = new Set(rows
    .filter((item) => item.kind === 'refund' && item.reference_id)
    .map((item) => `${provider(item.provider)}:${item.reference_id}`));
  const refunds = rows.filter((item) => {
    if (item.kind === 'refund') return true;
    if (amount(item.refunded) <= 0 && item.status !== 'Remboursé') return false;
    return !explicitRefundReferences.has(`${provider(item.provider)}:${item.id}`);
  });

  return {
    revenue: successful.filter((item) => providerCurrency(item) === currency)
      .reduce((sum, item) => sum + amount(item.signed_amount ?? item.amount), 0),
    refunded: refunds.filter((item) => providerCurrency(item) === currency)
      .reduce((sum, item) => sum + Math.abs(amount(item.refunded || item.amount)), 0),
    pending: pending.filter((item) => providerCurrency(item) === currency)
      .reduce((sum, item) => sum + Math.abs(amount(item.amount)), 0),
    successfulCount: successful.length,
    refundCount: refunds.length,
    pendingCount: pending.length,
  };
}

function providerCurrency(item) {
  return String(item?.currency || 'eur').trim().toLowerCase();
}

