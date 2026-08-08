import { paypalGet } from './pay-paypal.mjs';

const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 366 * DAY_MS;
const PAYPAL_SEARCH_DELAY_MS = 3 * 60 * 60 * 1_000;
const REFUND_CODES = new Set(['T1107', 'T1115', 'T1120']);
const PAYMENT_PLAN_CODES = new Set(['T0002']);

function safeDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date : null;
}

function clean(value, max = 220) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: clean(currency, 8).toUpperCase() || 'EUR' })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

function toMinor(value, currency) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * (10 ** currencyDigits(currency)));
}

function statusLabel(status) {
  if (status === 'S') return 'Réussi';
  if (status === 'P') return 'En attente';
  if (status === 'V') return 'Annulé';
  if (status === 'F') return 'Partiel';
  if (status === 'D') return 'Refusé';
  return 'Inconnu';
}

function payerName(payer = {}) {
  const name = payer?.payer_name || {};
  return clean([name.given_name, name.surname].filter(Boolean).join(' '), 140);
}

function transactionDescription(detail, kind) {
  const info = detail?.transaction_info || {};
  const item = detail?.cart_info?.item_details?.[0] || {};
  return clean(
    item.item_name
      || info.transaction_subject
      || info.transaction_note
      || info.invoice_id
      || (kind === 'refund' ? 'Remboursement PayPal' : 'Paiement PayPal'),
    180,
  );
}

export function classifyPayPalTransaction(eventCode, signedMinor) {
  const code = clean(eventCode, 5).toUpperCase();
  if (REFUND_CODES.has(code)) return 'refund';
  if (code.startsWith('T01')) return 'fee';
  if (code.startsWith('T04')) return 'transfer';
  if (code.startsWith('T11')) return 'reversal';
  if (PAYMENT_PLAN_CODES.has(code)) return 'payment_plan';
  if (code.startsWith('T00') || signedMinor > 0) return 'sale';
  return 'adjustment';
}

export function normalizePayPalTransaction(detail = {}) {
  const info = detail.transaction_info || {};
  const payer = detail.payer_info || {};
  const currency = clean(info.transaction_amount?.currency_code, 8).toLowerCase() || 'eur';
  const signedMinor = toMinor(info.transaction_amount?.value, currency);
  const eventCode = clean(info.transaction_event_code, 5).toUpperCase();
  const kind = classifyPayPalTransaction(eventCode, signedMinor);
  const status = statusLabel(clean(info.transaction_status, 1).toUpperCase());
  const refundMinor = kind === 'refund' ? Math.abs(signedMinor) : 0;
  const name = payerName(payer);
  const email = clean(payer.email_address, 180).toLowerCase();
  const initiatedAt = safeDate(info.transaction_initiation_date);
  return {
    id: clean(info.transaction_id, 80),
    provider: 'paypal',
    created: initiatedAt ? Math.floor(initiatedAt.getTime() / 1_000) : 0,
    updated: safeDate(info.transaction_updated_date)?.toISOString() || null,
    amount: Math.abs(signedMinor),
    signed_amount: signedMinor,
    refunded: refundMinor,
    refundable: 0,
    can_refund: false,
    currency,
    status: kind === 'refund' && status === 'Réussi' ? 'Remboursé' : status,
    kind,
    is_plan_payment: kind === 'payment_plan' || info.paypal_reference_id_type === 'SUB',
    description: transactionDescription(detail, kind),
    customer: name || email || 'Client PayPal',
    email,
    payment_method: 'PayPal',
    event_code: eventCode,
    reference_id: clean(info.paypal_reference_id, 80) || null,
    reference_type: clean(info.paypal_reference_id_type, 12) || null,
    invoice_id: clean(info.invoice_id, 120) || null,
    fee: Math.abs(toMinor(info.fee_amount?.value, info.fee_amount?.currency_code || currency)),
  };
}

export function payPalSearchRange({ start, end, now = Date.now() } = {}) {
  const latest = new Date(now - PAYPAL_SEARCH_DELAY_MS);
  const requestedEnd = safeDate(end) || latest;
  const safeEnd = requestedEnd > latest ? latest : requestedEnd;
  const requestedStart = safeDate(start) || new Date(safeEnd.getTime() - 30 * DAY_MS);
  if (requestedStart > safeEnd) throw new Error('paypal_range_invalid');
  if (safeEnd.getTime() - requestedStart.getTime() > MAX_RANGE_MS) throw new Error('paypal_range_too_large');
  return { start: requestedStart, end: safeEnd, delayedUntil: latest };
}

export function splitPayPalSearchRange(start, end) {
  const chunks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + 30 * DAY_MS));
    chunks.push({ start: new Date(cursor), end: chunkEnd });
    cursor = new Date(chunkEnd.getTime() + 1_000);
  }
  return chunks;
}

async function fetchPayPalChunk(chunk, options = {}) {
  const rows = [];
  const pageSize = Math.min(500, Math.max(1, Number(options.pageSize || 500)));
  let page = 1;
  let totalPages = 1;
  do {
    const data = await paypalGet('/v1/reporting/transactions', [
      ['start_date', chunk.start.toISOString()],
      ['end_date', chunk.end.toISOString()],
      ['fields', 'all'],
      ['page_size', pageSize],
      ['page', page],
    ], options);
    rows.push(...(Array.isArray(data.transaction_details) ? data.transaction_details : []));
    totalPages = Math.max(1, Math.min(20, Number(data.total_pages || 1)));
    page += 1;
  } while (page <= totalPages && rows.length < 10_000);
  return rows;
}

export async function getPayPalTransactions(options = {}) {
  const range = payPalSearchRange(options);
  const chunks = splitPayPalSearchRange(range.start, range.end);
  const details = [];
  for (const chunk of chunks) details.push(...await fetchPayPalChunk(chunk, options));
  const byId = new Map();
  for (const detail of details) {
    const row = normalizePayPalTransaction(detail);
    if (row.id) byId.set(row.id, row);
  }
  const transactions = [...byId.values()].sort((first, second) => second.created - first.created);
  return {
    connected: true,
    provider: 'paypal',
    delay_hours: 3,
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    transactions,
    metrics: payPalMetrics(transactions),
  };
}

export function payPalMetrics(transactions) {
  return transactions.reduce((metrics, item) => {
    const currency = item.currency || 'eur';
    metrics.revenue[currency] ||= 0;
    metrics.refunded[currency] ||= 0;
    metrics.fees[currency] ||= 0;
    metrics.net[currency] ||= 0;
    if (item.status === 'Réussi' && ['sale', 'payment_plan'].includes(item.kind) && item.signed_amount > 0) {
      metrics.revenue[currency] += item.signed_amount;
      metrics.successful += 1;
    }
    if (item.kind === 'refund') {
      metrics.refunded[currency] += item.refunded;
      metrics.refund_count += 1;
    }
    metrics.fees[currency] += item.fee || 0;
    metrics.net[currency] += item.signed_amount || 0;
    if (item.status === 'En attente') metrics.pending += 1;
    if (item.is_plan_payment && item.status === 'Réussi') metrics.plan_payments[currency] = (metrics.plan_payments[currency] || 0) + Math.max(0, item.signed_amount);
    return metrics;
  }, { revenue: {}, refunded: {}, fees: {}, net: {}, plan_payments: {}, successful: 0, refund_count: 0, pending: 0 });
}
