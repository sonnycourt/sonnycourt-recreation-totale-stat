import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { spiffyRead } from './onboarding-payments.mjs';
import { supabaseGet, supabasePatch } from './supabase-rest.mjs';
import { specialOffer } from '../../../src/data/es2-offre-speciale.mjs';

export const validReceipt = value => /^es2r_[a-f0-9]{48}$/.test(String(value || ''));
const clean = (value, max = 220) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const plans = { once: { checkout: 40007, amount: 129700 }, twelve: { checkout: 40006, amount: 19700 } };
const store = () => getStore({ name: 'es2-special-receipts', consistency: 'strong' });

export function orderMatchesReceipt(order, receipt, token) {
  const plan = plans[receipt.plan];
  const hasReference = value => value === receipt.reference || Boolean(value && typeof value === 'object' && Object.values(value).some(hasReference));
  return Boolean(plan && String(order?.customer?.email || '').trim().toLowerCase() === receipt.email
    && Number(order.checkout?.id) === plan.checkout
    && Date.parse(order.created_at) >= receipt.createdAt - 60000
    && order.payment_status === 'succeeded'
    && typeof receipt.reference === 'string' && receipt.reference.length > 30
    && (hasReference(order.attribution) || hasReference(order.preserved_params))
    && Array.isArray(order.payments) && order.payments.some(payment =>
      String(payment.order_id) === String(order.id) && payment.status === 'succeeded'
      && String(payment.currency).toLowerCase() === 'eur'
      && Number(payment.amount_paid) - Number(payment.amount_refunded || 0) >= plan.amount));
}

export function makeReceiptService({
  read = spiffyRead,
  get = key => store().get(key, { type: 'json' }),
  set = (key, value) => store().setJSON(key, value),
  dbGet = supabaseGet, dbPatch = supabasePatch, now = () => Date.now(),
} = {}) {
  return async body => {
    if (body.action === 'prepare') {
      // Calendar only. The page's existing seat mechanism is left untouched.
      if (!specialOffer.published || now() < Date.parse(specialOffer.startsAt) || now() >= Date.parse(specialOffer.endsAt))
        return { status: 409, data: { error: 'Cette ouverture n’est pas active.' } };
      const email = clean(body.email, 254).toLowerCase(), firstName = clean(body.firstName, 100);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !Object.hasOwn(plans, body.plan))
        return { status: 400, data: { error: 'Vérifie ton prénom et ton email.' } };
      const token = 'es2r_' + randomBytes(24).toString('hex');
      const reference = 'es2c_' + randomBytes(24).toString('hex');
      await set(token, { email, firstName, plan: body.plan, reference, createdAt: now() });
      return { status: 200, data: { token, reference } };
    }
    if (!['status', 'complete'].includes(body.action) || !validReceipt(body.token)) return { status: 400, data: { error: 'Confirmation incomplète.' } };
    const receipt = await get(body.token);
    if (!receipt || now() - receipt.createdAt > 7 * 86400000) return { status: 404, data: { error: 'Lien de confirmation introuvable ou expiré. Contacte-nous pour finaliser ton dossier.' } };
    let order;
    if (receipt.orderId) {
      order = (await read(`orders/${receipt.orderId}`, { include: 'attribution,payments,customer,checkout' })).data;
    } else {
      const customers = await read('customers', { 'filter[email]': receipt.email, per_page: 10 });
      const customer = customers.data?.find(item => String(item.email).toLowerCase() === receipt.email);
      if (customer && /^\d+$/.test(String(customer.id))) {
        const orders = await read('orders', { 'filter[customer_id]': customer.id, 'filter[created_at.gte]': new Date(receipt.createdAt - 60000).toISOString(), include: 'attribution,payments,customer,checkout', per_page: 100 });
        order = orders.data?.find(item => orderMatchesReceipt(item, receipt, body.token));
      }
    }
    // No webhook flag, browser success event or email alone is proof of payment.
    if (!orderMatchesReceipt(order, receipt, body.token)) return { status: 200, data: { paid: false } };
    if (!receipt.orderId) { receipt.orderId = String(order.id); await set(body.token, receipt); }
    if (body.action === 'status') return { status: 200, data: { paid: true, email: receipt.email, first_name: receipt.firstName } };
    const firstName = clean(body.first_name, 80), lastName = clean(body.last_name, 80);
    const patch = { billing_full_name: `${firstName} ${lastName}`.trim(), billing_phone: clean(body.phone, 40), billing_street: clean(body.street), billing_street2: clean(body.street2) || null, billing_zip: clean(body.zip, 30), billing_city: clean(body.city, 120), billing_country: clean(body.country, 80), billing_completed_at: new Date(now()).toISOString() };
    if (!firstName || !lastName || !patch.billing_phone || !patch.billing_street || !patch.billing_zip || !patch.billing_city || !patch.billing_country)
      return { status: 400, data: { error: 'Complète les champs obligatoires.' } };
    // Keep a durable copy, even while the ordinary purchase webhook catches up.
    await set(body.token, { ...receipt, billing: patch });
    let updated = 0;
    for (const table of ['mc2_registrations', 'webinaire_registrations']) {
      const rows = await dbGet(`${table}?email=eq.${encodeURIComponent(receipt.email)}&select=token&limit=1`);
      if (!rows.ok) throw new Error('registration_unavailable');
      if (!rows.data?.[0]?.token) continue;
      const result = await dbPatch(table, `token=eq.${encodeURIComponent(rows.data[0].token)}`, patch);
      if (!result.ok) throw new Error('billing_unavailable');
      updated++;
    }
    return { status: 200, data: { ok: true, registration_matched: updated > 0 } };
  };
}
