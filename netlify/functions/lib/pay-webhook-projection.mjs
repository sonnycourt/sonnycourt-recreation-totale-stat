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
  dispute: 'disputes',
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

function stripeInvoicePaymentOperation(event) {
  const invoice = event?.data?.object || {};
  const type = clean(event?.type, 180);
  if (!['invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed'].includes(type)) return null;
  const succeeded = type !== 'invoice.payment_failed';
  const externalId = objectId(invoice.payment_intent) || objectId(invoice);
  if (!externalId) return null;
  const metadata = {
    ...(invoice.subscription_details?.metadata || {}),
    customer_external_id: objectId(invoice.customer),
    customer_email: clean(invoice.customer_email, 200).toLowerCase(),
    customer_name: clean(invoice.customer_name, 200),
    payment_plan_external_id: objectId(invoice.subscription),
    invoice_external_id: objectId(invoice),
    failure_reason: clean(invoice.last_finalization_error?.message || invoice.last_payment_error?.message, 500),
  };
  return {
    table: 'pay_payments', conflict: 'provider,external_id',
    row: {
      provider: 'stripe', external_id: externalId, status: succeeded ? 'succeeded' : 'failed',
      currency: currency(invoice.currency), amount_minor: Math.max(0, Number(invoice.amount_paid || invoice.amount_due || 0) || 0),
      refunded_minor: 0, fee_minor: null, net_minor: null, payment_method_type: null,
      payment_method_brand: null, payment_method_last4: null,
      description: clean(invoice.description || invoice.lines?.data?.[0]?.description, 500) || 'Échéance Stripe',
      paid_at: succeeded ? safeIso(invoice.status_transitions?.paid_at || invoice.created) : null,
      due_at: safeIso(invoice.due_date || invoice.period_end),
      source_created_at: safeIso(invoice.created), source_updated_at: safeIso(invoice.updated || invoice.created || event.created),
      metadata,
    },
  };
}

function alertOperation(provider, event, options = {}) {
  const eventType = clean(provider === 'stripe' ? event?.type : event?.event_type, 180).toUpperCase();
  const resource = provider === 'stripe' ? event?.data?.object || {} : event?.resource || {};
  const isFailure = eventType === 'INVOICE.PAYMENT_FAILED' || eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED';
  const isDispute = eventType.includes('DISPUTE');
  if (!isFailure && !isDispute) return null;
  const entityId = objectId(resource) || objectId(resource.billing_agreement_id) || objectId(resource.dispute_id);
  if (!entityId) return null;
  const disputeClosed = /(?:CLOSED|RESOLVED)$/.test(eventType);
  const amountSource = resource.amount || resource.dispute_amount || {};
  const amountMinor = provider === 'stripe'
    ? Math.max(0, Number(resource.amount || resource.amount_due || 0) || 0)
    : amountToMinor(amountSource.value ?? amountSource.total, amountSource.currency_code || amountSource.currency || 'eur');
  const currencyCode = currency(provider === 'stripe' ? resource.currency : amountSource.currency_code || amountSource.currency);
  return {
    table: 'pay_alerts', conflict: 'provider,external_id',
    row: {
      provider, external_id: `${isDispute ? 'dispute' : 'payment_failed'}:${entityId}`,
      alert_type: isDispute ? 'dispute' : 'payment_failed', severity: isDispute ? 'critical' : 'warning',
      status: disputeClosed ? 'resolved' : 'open',
      title: isDispute ? 'Nouveau litige' : 'Échec de paiement',
      body: clean(resource.reason || resource.status_details?.reason || resource.status_change_note, 500)
        || (isDispute ? 'Un litige demande ton attention.' : 'Une échéance n’a pas pu être encaissée.'),
      entity_type: isDispute ? 'dispute' : 'payment', entity_external_id: entityId,
      customer_email: clean(resource.customer_email || resource.subscriber?.email_address || resource.payer?.email_address, 200).toLowerCase() || null,
      amount_minor: amountMinor, currency: currencyCode,
      occurred_at: safeIso(provider === 'stripe' ? event.created : event.create_time || resource.create_time),
      source_updated_at: safeIso(provider === 'stripe' ? resource.updated || event.created : event.update_time || resource.update_time || event.create_time),
      metadata: options.metadata || {},
    },
  };
}

function payPalDisputeOperation(event) {
  const type = clean(event?.event_type, 180).toUpperCase();
  if (!type.includes('DISPUTE')) return null;
  const resource = event?.resource || {};
  const amount = resource.dispute_amount || resource.amount || {};
  const externalId = objectId(resource);
  if (!externalId) return null;
  return {
    table: 'pay_disputes', conflict: 'provider,external_id',
    row: {
      provider: 'paypal', external_id: externalId, status: clean(resource.status, 60).toLowerCase() || 'unknown',
      currency: currency(amount.currency_code || amount.currency),
      amount_minor: amountToMinor(amount.value ?? amount.total, amount.currency_code || amount.currency),
      reason: clean(resource.reason || resource.dispute_life_cycle_stage, 120) || null,
      evidence_due_at: safeIso(resource.response_due_date), source_created_at: safeIso(resource.create_time || event.create_time),
      source_updated_at: safeIso(resource.update_time || event.update_time || event.create_time),
      metadata: { pay_origin: 'sonnycourt_pay' },
    },
  };
}

function prepareStripe(event) {
  const object = event?.data?.object || {};
  const invoiceEffect = object.object === 'invoice' ? stripeInvoiceEffect(event) : null;
  const invoicePayment = object.object === 'invoice' ? stripeInvoicePaymentOperation(event) : null;
  const alert = alertOperation('stripe', event, { metadata: object.metadata || object.subscription_details?.metadata || {} });
  if (invoiceEffect || invoicePayment) return { operations: [invoicePayment, alert].filter(Boolean), effects: [invoiceEffect].filter(Boolean), reason: null };
  const resource = STRIPE_RESOURCE_BY_OBJECT[clean(object.object, 100)];
  if (!resource) return { operations: [], effects: [], reason: 'stripe_object_not_in_pay_mvp' };
  if (object.deleted === true) return { operations: [], effects: [], reason: 'stripe_deleted_object_requires_existing_row' };
  return { operations: [...projectStripeResource(resource, object), alert].filter(Boolean), effects: [], reason: null };
}

function preparePayPal(event) {
  const type = clean(event?.event_type, 180).toUpperCase();
  const alert = alertOperation('paypal', event, { metadata: { pay_origin: 'sonnycourt_pay' } });
  const dispute = payPalDisputeOperation(event);
  if (dispute) return { operations: [dispute, alert].filter(Boolean), effects: [], reason: null };
  if (type.startsWith('BILLING.SUBSCRIPTION.')) {
    return { operations: [...projectPayPalSubscription(event.resource), alert].filter(Boolean), effects: [], reason: null };
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
