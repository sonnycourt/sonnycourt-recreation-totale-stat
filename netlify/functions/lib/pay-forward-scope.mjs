export const PAY_ORIGIN = 'sonnycourt_pay';
export const PAY_FORWARD_CUTOVER = '2026-08-09T00:00:00+02:00';

const STRIPE_SCOPED_RESOURCES = new Set([
  'customers',
  'payment_intents',
  'setup_intents',
  'charges',
  'refunds',
  'disputes',
  'products',
  'prices',
  'plans',
  'coupons',
  'promotion_codes',
  'payment_links',
  'checkout_sessions',
  'invoices',
  'invoice_items',
  'credit_notes',
  'subscriptions',
  'subscription_schedules',
  'quotes',
  'events',
]);

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalized(value) {
  return clean(value, 255).toLowerCase().replace(/[\s-]+/g, '_');
}

function metadataSources(object = {}) {
  return [
    object.metadata,
    object.subscription_details?.metadata,
    object.payment_intent_data?.metadata,
    object.subscription_data?.metadata,
    object.payment_intent?.metadata,
    object.charge?.metadata,
    object.data?.object?.metadata,
    object.data?.object?.subscription_details?.metadata,
  ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function isPayValue(value) {
  const item = normalized(value);
  return item === PAY_ORIGIN || item === 'pay' || item.startsWith('sonnycourt_pay:') || item.startsWith('pay:');
}

function isSpiffyValue(value) {
  const item = normalized(value);
  return item === 'spiffy' || item === 'true' || item.startsWith('spiffy_') || item.startsWith('spiffy:');
}

export function payCutoverIso(env = process.env) {
  const configured = clean(env.PAY_FORWARD_ONLY_FROM, 80);
  const parsed = new Date(configured || PAY_FORWARD_CUTOVER);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(PAY_FORWARD_CUTOVER).toISOString();
}

export function payCutoverUnix(env = process.env) {
  return Math.floor(new Date(payCutoverIso(env)).getTime() / 1_000);
}

export function isAfterPayCutover(value, env = process.env) {
  const date = typeof value === 'number' ? new Date(value * 1_000) : new Date(String(value || ''));
  return Number.isFinite(date.getTime()) && date.getTime() >= new Date(payCutoverIso(env)).getTime();
}

export function payMetadataBelongsToPay(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    if (isSpiffyValue(source.is_spiffy) || isSpiffyValue(source.source) || isSpiffyValue(source.pay_origin)) return false;
    if ([source.pay_origin, source.source, source.pay_route, source.integration].some(isPayValue)) return true;
  }
  return false;
}

export function stripeObjectBelongsToPay(object = {}, options = {}) {
  const eventObject = object?.object === 'event' ? object.data?.object || {} : object;
  const created = object.created || eventObject.created || object.data?.object?.created;
  if (!isAfterPayCutover(created, options.env)) return false;
  return payMetadataBelongsToPay(...metadataSources(object), ...metadataSources(eventObject));
}

export function stripeResourceIsForwardScoped(resource) {
  return STRIPE_SCOPED_RESOURCES.has(clean(resource, 80));
}

export function payPalReferenceBelongsToPay(value) {
  const item = clean(value, 255).toLowerCase();
  return item.startsWith('pay:') || item.startsWith('pay-') || item.startsWith('sonnycourt_pay:');
}

export function payPalObjectBelongsToPay(object = {}, options = {}) {
  const created = object.created || object.create_time || object.createTime || object.transaction_initiation_date;
  if (!isAfterPayCutover(created, options.env)) return false;
  return [
    object.custom_id,
    object.invoice_id,
    object.invoice_number,
    object.reference,
    object.pay_reference,
    object.metadata?.pay_origin,
    object.metadata?.source,
  ].some(payPalReferenceBelongsToPay);
}

export function payPalCatalogObjectIsForward(object = {}, options = {}) {
  if (!isAfterPayCutover(object.create_time || object.created, options.env)) return false;
  if (payPalObjectBelongsToPay(object, options)) return true;
  return ['products', 'plans'].includes(clean(options.resource, 40));
}

export function payScopeSummary(env = process.env) {
  return { scope: 'forward_pay_only', origin: PAY_ORIGIN, cutover_at: payCutoverIso(env) };
}
