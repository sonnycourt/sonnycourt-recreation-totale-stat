import { spiffyRead } from './onboarding-payments.mjs';
import { supabaseGet, supabasePatch } from './supabase-rest.mjs';
import { MC2_ENTRY_CHECKOUT_ID, MC2_ENTRY_AMOUNT_MINOR, MC2_ENTRY_CURRENCY, mc2EntryPaymentPending } from '../../../src/lib/mc2-entry-payment.mjs';
import { completeMc2EntryRegistration } from '../register-mc2.js';

const same = (a, b) => String(a ?? '') === String(b ?? '');
const numeric = value => /^\d+$/.test(String(value));
export function verifiedEntryPayment(order, payments, row, customerId) {
  if (!row?.entry_payment_required || !row?.telephone || !row?.pays) return null;
  if (!numeric(order?.id) || !same(order.customer_id, customerId)) return null;
  if (!same(order.checkout?.id ?? order.checkout_id, MC2_ENTRY_CHECKOUT_ID)) return null;
  if (String(order.currency).toLowerCase() !== MC2_ENTRY_CURRENCY) return null;
  const registered = Date.parse(row.registered_at), created = Date.parse(order.created_at);
  if (!Number.isFinite(registered) || !Number.isFinite(created) || created < registered) return null;
  if (!Array.isArray(payments) || payments.some(p => !same(p.order_id, order.id))) return null;
  if (payments.some(p => Number(p.amount_refunded) > 0 || ['refunded', 'disputed', 'dispute_refunded'].includes(p.status))) return null;
  const payment = payments.find(p => p.status === 'succeeded'
    && String(p.currency).toLowerCase() === MC2_ENTRY_CURRENCY
    && Number(p.amount) === MC2_ENTRY_AMOUNT_MINOR
    && Number(p.amount_paid) === MC2_ENTRY_AMOUNT_MINOR
    && Number(p.amount_refunded || 0) === 0 && !p.is_manual);
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
    const response = await read(`orders/${orderId}`, { include: 'checkout' });
    orders = [response?.data && !Array.isArray(response.data) ? response.data : response];
  } else {
    orders = await rows(read, 'orders', { 'filter[customer_id]': customerId, include: 'checkout' });
  }
  for (let order of orders) {
    if (!numeric(order?.id) || !same(order.customer_id, customerId)
      || !same(order.checkout?.id ?? order.checkout_id, MC2_ENTRY_CHECKOUT_ID)) continue;
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
