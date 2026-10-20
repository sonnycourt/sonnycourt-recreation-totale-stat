import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { spiffyRead } from './onboarding-payments.mjs';

const clean = (value, max = 220) => typeof value === 'string' ? value.trim().slice(0, max) : '';

// Payment verification only: email + order number are NOT an account login.
// Never disclose stored personal data, grant access or overwrite CRM records here.
export function isPremiumPayment(order, orderId, email) {
  if (String(order?.id) !== orderId || clean(order?.customer?.email, 254).toLowerCase() !== email) return false;
  const checkout = Number(order.checkout?.id ?? order.checkout_id);
  const expected = checkout === 41175 ? 19700 : checkout === 41049 ? 129700 : 0;
  if (!expected || order.payment_status !== 'succeeded') return false;
  return Array.isArray(order.payments) && order.payments.some(payment =>
    String(payment.order_id) === orderId && payment.status === 'succeeded'
    && String(payment.currency).toLowerCase() === 'eur'
    && Number(payment.amount_paid) === expected && Number(payment.amount_refunded || 0) === 0);
}

export function makePremiumBilling({ read = spiffyRead, save = (key, value) => getStore({ name: 'es2-premium-billing', consistency: 'strong' }).setJSON(key, value), now = () => new Date().toISOString(), uuid = randomUUID } = {}) {
  return async body => {
    const orderId = clean(body.order, 20), email = clean(body.email, 254).toLowerCase();
    if (!/^\d{1,20}$/.test(orderId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['status', 'complete'].includes(body.action))
      return { status: 400, data: { error: 'Le lien de confirmation est incomplet. Contacte notre équipe sans effectuer de nouveau paiement.' } };
    const result = await read(`orders/${orderId}`, { include: 'customer,checkout,payments' });
    const order = result.data;
    if (!isPremiumPayment(order, orderId, email)) return { status: 200, data: { paid: false } };
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
