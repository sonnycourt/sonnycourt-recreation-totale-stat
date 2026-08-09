import Stripe from 'stripe';

const METHOD_PATHS = Object.freeze({
  'products.create': ['products', 'create'],
  'paymentLinks.create': ['paymentLinks', 'create'],
  'coupons.create': ['coupons', 'create'],
  'promotionCodes.create': ['promotionCodes', 'create'],
});

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function secretFrom(env = process.env) {
  return clean(env.STRIPE_PAY_SECRET_KEY || env.STRIPE_SECRET_KEY, 300);
}

function keyMode(secret) {
  if (/^(?:sk|rk)_live_/.test(secret)) return 'live';
  if (/^(?:sk|rk)_test_/.test(secret)) return 'test';
  return 'unknown';
}

export function payCatalogWriteState(env = process.env) {
  const secret = secretFrom(env);
  const configured = Boolean(secret);
  const mode = keyMode(secret);
  return {
    configured,
    mode,
    writes_enabled: configured && env.PAY_STRIPE_CATALOG_WRITES_ENABLED === 'true',
  };
}

function executionError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function commandMethod(client, stripeMethod) {
  const path = METHOD_PATHS[stripeMethod];
  if (!path) throw executionError('pay_catalog_method_invalid');
  const owner = client?.[path[0]];
  const method = owner?.[path[1]];
  if (typeof method !== 'function') throw executionError('pay_catalog_client_invalid', 500);
  return method.bind(owner);
}

function referenceValue(value, results) {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  const [operationId, ...path] = value.slice(1).split('.');
  let result = results.get(operationId);
  if (!result) throw executionError('pay_catalog_dependency_missing');
  for (const key of path) result = result?.[key];
  if (result === undefined || result === null || result === '') throw executionError('pay_catalog_dependency_value_missing');
  return result;
}

function resolveReferences(value, results) {
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, results));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, results)]));
  }
  return referenceValue(value, results);
}

function publicStripeObject(object = {}) {
  return {
    id: clean(object.id, 255),
    object: clean(object.object, 80) || null,
    status: clean(object.status, 80) || null,
    active: typeof object.active === 'boolean' ? object.active : null,
    code: clean(object.code, 80) || null,
    url: clean(object.url, 1_000) || null,
    livemode: typeof object.livemode === 'boolean' ? object.livemode : null,
  };
}

function validateCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw executionError('pay_catalog_command_invalid');
  if (!/^[a-f0-9]{64}$/.test(clean(command.fingerprint, 64))) throw executionError('pay_catalog_fingerprint_invalid');
  if (!Array.isArray(command.operations) || !command.operations.length) throw executionError('pay_catalog_operations_invalid');
  const ids = new Set();
  for (const operation of command.operations) {
    const id = clean(operation?.id, 80);
    if (!id || ids.has(id)) throw executionError('pay_catalog_operation_id_invalid');
    ids.add(id);
    if (!METHOD_PATHS[clean(operation?.stripe_method, 80)]) throw executionError('pay_catalog_method_invalid');
    if (!clean(operation?.idempotency_key, 255)) throw executionError('pay_catalog_idempotency_invalid');
  }
}

export async function executePayCatalogCommand(command, options = {}) {
  validateCommand(command);
  const env = options.env || process.env;
  const state = payCatalogWriteState(env);
  if (!state.configured) throw executionError('stripe_secret_missing', 503);
  if (!state.writes_enabled) throw executionError('stripe_catalog_writes_disabled', 403);
  const client = options.client || new Stripe(secretFrom(env), { maxNetworkRetries: 2 });
  const results = new Map();
  const completed = [];
  try {
    for (const operation of command.operations) {
      for (const dependency of operation.depends_on || []) {
        if (!results.has(dependency)) throw executionError('pay_catalog_dependency_missing');
      }
      const create = commandMethod(client, clean(operation.stripe_method, 80));
      const params = resolveReferences(operation.params || {}, results);
      const object = await create(params, { idempotencyKey: clean(operation.idempotency_key, 255) });
      if (!clean(object?.id, 255)) throw executionError('pay_catalog_stripe_identity_missing', 502);
      results.set(operation.id, object);
      completed.push({ id: operation.id, stripe_method: operation.stripe_method, result: publicStripeObject(object) });
    }
  } catch (error) {
    error.completed_operations = completed.length;
    throw error;
  }
  return {
    ok: true,
    mode: state.mode,
    fingerprint: command.fingerprint,
    kind: command.kind,
    flow: command.flow || null,
    operations: completed,
    continuation: command.continuation || null,
  };
}
