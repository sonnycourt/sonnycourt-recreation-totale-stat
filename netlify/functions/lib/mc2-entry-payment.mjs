import { spiffyRead } from './onboarding-payments.mjs';
import { supabaseGet, supabasePatch } from './supabase-rest.mjs';
import { MC2_ENTRY_CHECKOUT_ID, MC2_ENTRY_PRODUCT_ID, MC2_ENTRY_AMOUNT_MINOR, MC2_ENTRY_CURRENCY, mc2EntryPaymentPending } from '../../../src/lib/mc2-entry-payment.mjs';
import { completeMc2EntryRegistration } from '../register-mc2.js';

const same = (a, b) => String(a ?? '') === String(b ?? '');
const numeric = value => /^\d+$/.test(String(value));
const entryProductId = item => item?.price?.option?.product?.id
  ?? item?.product?.id ?? item?.product_id ?? item?.productId;
const hasEntryProduct = order => Array.isArray(order?.items)
  && order.items.length === 1
  && same(entryProductId(order.items[0]), MC2_ENTRY_PRODUCT_ID)
  && Number(order.items[0]?.price?.amount ?? order.items[0]?.amount ?? order.items[0]?.total) === MC2_ENTRY_AMOUNT_MINOR;
const isEntryOrder = order => {
  const checkoutId = order?.checkout?.id ?? order?.checkout_id;
  // Spiffy's v2 order API currently omits checkout.id and exposes only its
  // internal checkout_publish_id. The dedicated product is therefore the
  // stable provider-side identity when checkout.id is absent.
  return checkoutId != null ? same(checkoutId, MC2_ENTRY_CHECKOUT_ID) : hasEntryProduct(order);
};
const isGatewayPayment = payment => !payment?.is_manual
  || (numeric(payment?.gateway_id)
    && (/^ch_/.test(String(payment?.stripe_charge_id || ''))
      || /^pi_/.test(String(payment?.stripe_paymentintent_id || ''))));
export function verifiedEntryPayment(order, payments, row, customerId) {
  if (!row?.entry_payment_required || !row?.telephone || !row?.pays) return null;
  if (!numeric(order?.id) || !same(order.customer_id, customerId)) return null;
  if (!isEntryOrder(order)) return null;
  if (String(order.currency).toLowerCase() !== MC2_ENTRY_CURRENCY) return null;
  if (order.payment_status && order.payment_status !== 'succeeded') return null;
  if (order.detail && (Number(order.detail.total) !== MC2_ENTRY_AMOUNT_MINOR || Number(order.detail.due_today) !== MC2_ENTRY_AMOUNT_MINOR)) return null;
  const registered = Date.parse(row.registered_at), created = Date.parse(order.created_at);
  if (!Number.isFinite(registered) || !Number.isFinite(created) || created < registered) return null;
  if (!Array.isArray(payments) || payments.some(p => !same(p.order_id, order.id))) return null;
  if (payments.some(p => Number(p.amount_refunded) > 0 || ['refunded', 'disputed', 'dispute_refunded'].includes(p.status))) return null;
  const payment = payments.find(p => p.status === 'succeeded'
    && String(p.currency).toLowerCase() === MC2_ENTRY_CURRENCY
    && Number(p.amount) === MC2_ENTRY_AMOUNT_MINOR
    && Number(p.amount_paid) === MC2_ENTRY_AMOUNT_MINOR
    && Number(p.amount_refunded || 0) === 0
    && (!p.customer_id || same(p.customer_id, customerId))
    && isGatewayPayment(p));
  return payment && Number.isFinite(Date.parse(payment.created_at)) ? payment : null;
}

async function rows(read, path, params) {
  const response = await read(path, { ...params, per_page: 100, page: 1 });
  const data = response?.data;
  const total = response?.meta?.pagination?.total_count ?? response?.pagination?.total;
  if (!Array.isArray(data) || !Number.isInteger(total) || total !== data.length) throw new Error('entry_incomplete_provider_data');
  return data;
}

export async function confirmMc2EntryPayment(req, row, { orderId = '', read = spiffyRead, patch = supabasePatch, complete = completeMc2EntryRegistration } = {}) {
  if (!mc2EntryPaymentPending(row)) {
    // Replaying a verified order repairs interrupted idempotent reminder queues.
    if (row?.entry_payment_required && row?.entry_payment_paid_at) await complete(req, row);
    return { paid: Boolean(row?.entry_payment_paid_at), historical: !row?.entry_payment_required };
  }
  if (!row.telephone || !row.pays) return { paid: false };
  const customers = await rows(read, 'customers', { 'filter[email]': row.email });
  const matched = customers.filter(c => String(c.email || '').trim().toLowerCase() === row.email.toLowerCase());
  if (matched.length !== 1 || !numeric(matched[0].id)) return { paid: false };
  const customerId = matched[0].id;
  let orders;
  if (orderId) {
    if (!numeric(orderId)) return { paid: false };
    const response = await read(`orders/${orderId}`, { include: 'items' });
    orders = [response?.data && !Array.isArray(response.data) ? response.data : response];
  } else {
    orders = await rows(read, 'orders', { 'filter[customer_id]': customerId, include: 'items' });
  }
  for (let order of orders) {
    if (!numeric(order?.id) || !same(order.customer_id, customerId) || !isEntryOrder(order)) continue;
    const payments = await rows(read, 'payments', { 'filter[order_id]': order.id });
    const payment = verifiedEntryPayment(order, payments, row, customerId);
    if (!payment) continue;
    const update = {
      entry_payment_paid_at: new Date(payment.created_at).toISOString(),
      entry_payment_order_id: String(order.id), entry_payment_checkout_id: MC2_ENTRY_CHECKOUT_ID,
      statut: 'registered', registration_completed_at: new Date().toISOString(),
    };
    const saved = await patch('mc2_registrations', `token=eq.${encodeURIComponent(row.token)}&entry_payment_required=eq.true&entry_payment_paid_at=is.null`, update);
    if (!saved.ok) throw new Error('entry_payment_save_failed');
    if (!Array.isArray(saved.data) || saved.data.length !== 1) return { paid: false, retry: true };
    const confirmed = { ...row, ...update };
    await complete(req, confirmed);
    return { paid: true, redirectTo: `/mc2/confirmation?t=${encodeURIComponent(row.token)}` };
  }
  return { paid: false };
}

export async function entryRegistrationByToken(token) {
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(String(token || ''))) return null;
  const result = await supabaseGet(`mc2_registrations?token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
  if (!result.ok) throw new Error('entry_registration_unavailable');
  return result.data?.[0] || null;
}
