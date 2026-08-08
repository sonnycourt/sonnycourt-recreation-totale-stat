import { payWebhookEnvelope } from './pay-webhook-contract.mjs';
import {
  projectPayPalSubscription,
  projectPayPalTransaction,
  projectStripeResource,
  validatePayProjection,
} from './pay-provider-projection.mjs';

const STRIPE_RESOURCE_BY_OBJECT = Object.freeze({
  customer: 'customers',
  product: 'products',
  price: 'prices',
  payment_link: 'payment_links',
  'checkout.session': 'checkout_sessions',
  payment_intent: 'payment_intents',
  refund: 'refunds',
  subscription: 'subscriptions',
  coupon: 'coupons',
  promotion_code: 'promotion_codes',
});

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function objectId(value) {
  return clean(typeof value === 'string' ? value : value?.id, 255);
}

function safeIso(value) {
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function currency(value) {
  const code = clean(value, 8).toLowerCase();
  return /^[a-z]{3}$/.test(code) ? code : 'eur';
}

function amountToMinor(value, currencyCode = 'eur') {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency: currency(currencyCode).toUpperCase() })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    digits = 2;
  }
  return Math.max(0, Math.round(Math.abs(amount) * (10 ** digits)));
}

function paypalAmount(resource = {}) {
  const source = resource.amount || resource.transaction_fee || {};
  const value = source.value ?? source.total ?? resource.amount?.total ?? 0;
  const code = source.currency_code || source.currency || resource.amount?.currency || 'eur';
  return { amount: amountToMinor(value, code), currency: currency(code) };
}

function paypalFee(resource = {}, currencyCode = 'eur') {
  const fee = resource.seller_receivable_breakdown?.paypal_fee || resource.transaction_fee || {};
  return amountToMinor(fee.value ?? fee.total, fee.currency_code || fee.currency || currencyCode);
}

function paypalStatus(eventType, resourceStatus) {
  const status = clean(resourceStatus, 80).toUpperCase() || clean(eventType.split('.').at(-1), 80).toUpperCase();
  if (['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'PAID', 'ACTIVE'].includes(status)) return 'Réussi';
  if (['PENDING', 'PROCESSING', 'APPROVAL_PENDING', 'APPROVED'].includes(status)) return 'En attente';
  if (['REFUNDED'].includes(status)) return 'Remboursé';
  if (['REVERSED', 'CANCELLED', 'CANCELED', 'VOIDED'].includes(status)) return 'Annulé';
  if (['FAILED', 'DENIED', 'DECLINED', 'SUSPENDED', 'EXPIRED'].includes(status)) return 'Refusé';
  return status || 'Inconnu';
}

function paypalReference(resource = {}) {
  const related = resource.supplementary_data?.related_ids || {};
  return objectId(
    related.capture_id
      || related.sale_id
      || related.order_id
      || resource.billing_agreement_id
      || resource.parent_payment,
  );
}

function normalizePayPalWebhookTransaction(event) {
  const type = clean(event?.event_type, 180).toUpperCase();
  const resource = event?.resource || {};
  const { amount, currency: currencyCode } = paypalAmount(resource);
  const isRefundResource = type.startsWith('PAYMENT.REFUND.');
  const isParentRefundUpdate = /\.(REFUNDED|REVERSED)$/.test(type) && !isRefundResource;
  const isSubscriptionPayment = type.startsWith('PAYMENT.SALE.') && Boolean(resource.billing_agreement_id);
  const payer = resource.payer || resource.payer_info || {};
  const payerEmail = clean(payer.email_address || payer.email, 200).toLowerCase();
  const payerName = clean([
    payer.name?.given_name || payer.payer_name?.given_name,
    payer.name?.surname || payer.payer_name?.surname,
  ].filter(Boolean).join(' '), 200);
  const reference = paypalReference(resource);
  return {
    id: objectId(resource),
    created: Math.floor((new Date(resource.create_time || event.create_time || 0).getTime() || 0) / 1_000),
    updated: safeIso(event.update_time || resource.update_time || event.create_time),
    kind: isRefundResource ? 'refund' : isSubscriptionPayment ? 'payment_plan' : 'sale',
    status: paypalStatus(type, resource.status), amount,
    signed_amount: isRefundResource ? -amount : amount,
    refunded: isRefundResource || isParentRefundUpdate ? amount : 0,
    fee: paypalFee(resource, currencyCode), currency: currencyCode,
    description: clean(resource.description || resource.note_to_payer || resource.invoice_id || resource.custom_id, 500)
      || (isRefundResource ? 'Remboursement PayPal' : 'Paiement PayPal'),
    customer: payerName || payerEmail || 'Client PayPal', email: payerEmail,
    country: clean(payer.address?.country_code || payer.country_code, 2).toUpperCase(),
    reference_id: reference || null,
    reference_type: resource.billing_agreement_id ? 'SUB' : null,
    invoice_id: clean(resource.invoice_id, 120) || null,
    event_code: type,
  };
}

function stripeInvoiceEffect(event) {
  const invoice = event?.data?.object || {};
  const type = clean(event?.type, 180);
  if (!['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.upcoming'].includes(type)) return null;
  const status = ['invoice.paid', 'invoice.payment_succeeded'].includes(type)
    ? 'paid'
    : type === 'invoice.payment_failed' ? 'failed' : 'pending';
  const subscriptionId = objectId(invoice.subscription);
  const effectId = objectId(invoice) || [subscriptionId, invoice.period_end || invoice.due_date].filter(Boolean).join(':');
  if (!effectId) return null;
  return {
    type: 'payment_plan_installment', provider: 'stripe', external_id: effectId, status,
    subscription_external_id: subscriptionId, payment_external_id: objectId(invoice.payment_intent),
    currency: currency(invoice.currency), amount_minor: Math.max(0, Number(invoice.amount_paid || invoice.amount_due || 0) || 0),
    due_at: safeIso(invoice.due_date || invoice.period_end), paid_at: status === 'paid' ? safeIso(invoice.status_transitions?.paid_at || invoice.created) : null,
    source_updated_at: safeIso(invoice.updated || invoice.created || event.created),
  };
}

function prepareStripe(event) {
  const object = event?.data?.object || {};
  const invoiceEffect = object.object === 'invoice' ? stripeInvoiceEffect(event) : null;
  if (invoiceEffect) return { operations: [], effects: [invoiceEffect], reason: null };
  const resource = STRIPE_RESOURCE_BY_OBJECT[clean(object.object, 100)];
  if (!resource) return { operations: [], effects: [], reason: 'stripe_object_not_in_pay_mvp' };
  if (object.deleted === true) return { operations: [], effects: [], reason: 'stripe_deleted_object_requires_existing_row' };
  return { operations: projectStripeResource(resource, object), effects: [], reason: null };
}

function preparePayPal(event) {
  const type = clean(event?.event_type, 180).toUpperCase();
  if (type.startsWith('BILLING.SUBSCRIPTION.')) {
    return { operations: projectPayPalSubscription(event.resource), effects: [], reason: null };
  }
  if (type.startsWith('PAYMENT.CAPTURE.') || type.startsWith('PAYMENT.SALE.') || type.startsWith('PAYMENT.REFUND.')) {
    return { operations: projectPayPalTransaction(normalizePayPalWebhookTransaction(event)), effects: [], reason: null };
  }
  return { operations: [], effects: [], reason: 'paypal_event_not_in_pay_mvp' };
}

export function preparePayWebhookEvent(provider, event, options = {}) {
  const envelope = payWebhookEnvelope(provider, event, options);
  const prepared = envelope.provider === 'stripe' ? prepareStripe(event) : preparePayPal(event);
  if (prepared.operations.length) validatePayProjection(prepared.operations);
  const projected = prepared.operations.length > 0 || prepared.effects.length > 0;
  return {
    mode: 'dry_run', decision: projected ? 'projected' : 'ignored', reason: projected ? null : prepared.reason,
    envelope, operations: prepared.operations, effects: prepared.effects,
  };
}

export function summarizePreparedWebhook(prepared) {
  const counts = {};
  for (const item of prepared?.operations || []) counts[item.table] = (counts[item.table] || 0) + 1;
  return {
    mode: 'dry_run', decision: prepared?.decision || 'ignored', reason: prepared?.reason || null,
    provider: prepared?.envelope?.provider || null, event_id: prepared?.envelope?.event_id || null,
    event_type: prepared?.envelope?.event_type || null, object_id: prepared?.envelope?.object_id || null,
    payload_hash: prepared?.envelope?.payload_hash || null, routing_targets: prepared?.envelope?.routing?.targets || [],
    operation_count: (prepared?.operations || []).length, operations_by_table: counts,
    effects: (prepared?.effects || []).map((effect) => effect.type),
  };
}
