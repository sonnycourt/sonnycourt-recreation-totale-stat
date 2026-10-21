import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { spiffyRead } from './onboarding-payments.mjs';

const clean = (value, max = 220) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const cents = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const containsId = (ids, id) => Array.isArray(ids) && ids.map(String).includes(String(id));
const matchesBuyer = (order, orderId, email) => String(order?.id) === orderId
  && clean(order?.customer?.email, 254).toLowerCase() === email;
const checkoutId = order => Number(order?.checkout?.id ?? order?.checkout_id);

// Payment verification only: email + order number are NOT an account login.
// Never disclose stored personal data, grant access or overwrite CRM records here.
export function isPremiumPayment(order, orderId, email) {
  if (!matchesBuyer(order, orderId, email)) return false;
  const checkout = checkoutId(order);
  const native = [41049, 41096].includes(checkout);
  if ((!native && checkout !== 41175) || order.payment_status !== 'succeeded') return false;
  // Trust only the frozen order returned by Spiffy, never a URL/client amount
  // or the checkout's current price (which may have changed since purchase).
  const lines = order.detail?.line_items;
  if (!Array.isArray(lines) || !Array.isArray(order.items) || !Array.isArray(order.payments)) return false;
  return lines.some(line => {
    if (line.is_skipped || line.is_refunded_by_spiffy || !cents(line.total)) return false;
    const item = order.items.find(item => String(item.id) === String(line.order_item_id));
    if (!item || !Array.isArray(item.payment_ids)) return false;
    let expected, plan;
    if (native) {
      // Native Spiffy upsells have no product ID: the dedicated checkout,
      // upsell type/name and linked item/payment identify this offer together.
      if (line.block_type !== 'upsell' || line.name !== 'Esprit Subconscient 2.0 (Paiement unique)') return false;
      expected = cents(line.total);
    } else {
      if (Number(item.price?.option?.product_id) !== 11324) return false;
      plan = order.paymentplans?.find(plan => String(plan.order_id) === orderId
        && containsId(plan.item_ids, item.id)
        && ['active', 'finished', 'completed'].includes(plan.status)
        && plan.detail?.frequency === 'month' && Number(plan.detail.frequency_count) === 1
        && Number(plan.detail.num_payments) === 12
        && plan.detail.paymentplan_items?.some(part => String(part.order_item_id) === String(item.id)
          && !part.is_finance_fee && cents(part.total_due_amount) === cents(line.total)));
      if (!plan) return false;
      // Initial deposit replaces the regular instalment when configured.
      expected = cents(plan.detail.initial_deposit_amount) || cents(plan.detail.payment_total_amount);
    }
    return expected > 0 && order.payments.some(payment =>
    String(payment.order_id) === orderId && payment.status === 'succeeded'
    && String(payment.currency).toLowerCase() === 'eur'
    && cents(payment.amount) === expected && cents(payment.amount_paid) === expected
    && Number(payment.amount_refunded || 0) === 0
    && containsId(item.payment_ids, payment.id)
    && (!plan || containsId(plan.payment_ids, payment.id)));
  });
}

export function makePremiumBilling({ read = spiffyRead, save = (key, value) => getStore({ name: 'es2-premium-billing', consistency: 'strong' }).setJSON(key, value), now = () => new Date().toISOString(), uuid = randomUUID } = {}) {
  return async body => {
    const orderId = clean(body.order, 20), email = clean(body.email, 254).toLowerCase();
    if (!/^\d{1,20}$/.test(orderId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['status', 'complete'].includes(body.action))
      return { status: 400, data: { error: 'Le lien de confirmation est incomplet. Contacte notre équipe sans effectuer de nouveau paiement.' } };
    const result = await read(`orders/${orderId}`, { include: 'customer,checkout,payments,items,paymentplans' });
    const order = result.data;
    if (!isPremiumPayment(order, orderId, email)) return { status: 200, data: {
      paid: false,
      // A Delta order may already be succeeded before its ES2 upsell and
      // linked payment become visible. Allow bounded polling for that case.
      // Never disclose customer details or payment amounts to the caller.
      retryable: matchesBuyer(order, orderId, email)
        && [41049, 41096, 41175].includes(checkoutId(order))
        && !['failed', 'refunded', 'canceled', 'cancelled'].includes(order?.payment_status),
    } };
    if (body.action === 'status') return { status: 200, data: { paid: true } };
    const billing = Object.fromEntries(['first_name', 'last_name', 'phone', 'street', 'street2', 'zip', 'city', 'country'].map(key => [key, clean(body[key])]));
    if (Object.entries(billing).some(([key, value]) => key !== 'street2' && !value))
      return { status: 400, data: { error: 'Complète les champs obligatoires.' } };
    // Immutable submissions, separate from MC2 registrations. No email-only
    // update can replace an existing student's identity, address or notes.
    await save(`${orderId}/${uuid()}`, { version: 1, order_id: orderId, checkout_id: Number(order.checkout?.id ?? order.checkout_id), email, billing, submitted_at: now(), source: 'customer_submitted', payment_verified: true });
    return { status: 200, data: { ok: true } };
  };
}
