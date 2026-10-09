// Order-scoped references only: never infer an identity from a name/phone or
// from mutable custom fields on the customer's profile.
const keys = ['mc2_token', 'registration_token', 'client_reference_id'];
export function mc2OrderReference(payload) {
  const values = new Set();
  let invalid = false;
  const add = value => {
    if (value == null || value === '') return;
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,160}$/.test(value.trim())) {
      invalid = true;
    } else values.add(value.trim());
  };
  const visit = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 6) return;
    for (const key of keys) if (Object.hasOwn(obj, key)) add(obj[key]);
    if (keys.includes(obj.field_name)) add(obj.value);
    // Explicit envelopes and order containers; don't recursively scan customer,
    // card, product descriptions, unrelated nested orders or arbitrary strings.
    for (const key of ['data', 'object', 'order', 'metadata', 'preserved_params', 'fields']) {
      if (Array.isArray(obj[key])) obj[key].forEach(item => visit(item, depth + 1));
      else visit(obj[key], depth + 1);
    }
  };
  visit(payload);
  if (invalid) return { state: 'invalid', token: '' };
  if (values.size > 1) return { state: 'conflict', token: '' };
  return { state: values.size ? 'valid' : 'absent', token: [...values][0] || '' };
}

// Spiffy v2 order:success omits the fields expansion. GET the exact order; no
// search by similar email/phone, no provider mutation and no browser success flag.
export async function readMc2SpiffyIdentity({ orderId, checkoutId, email }, {
  fetcher = globalThis.fetch, env = process.env,
} = {}) {
  if (!/^[1-9]\d*$/.test(String(orderId || ''))) return { state: 'invalid', token: '' };
  const key = String(env.SPIFFY_ONBOARDING_API_KEY || '').trim();
  if (!key) return { state: 'unavailable', token: '' };
  try {
    const response = await fetcher(`https://api.spiffy.co/v2/orders/${orderId}?include=fields,customer,checkout`, {
      method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { state: 'unavailable', token: '' };
    const { data: order } = await response.json();
    if (String(order?.id) !== String(orderId)
      || String(order?.checkout?.id) !== String(checkoutId)
      || String(order?.customer?.email || '').trim().toLowerCase() !== email
      || order?.payment_status !== 'succeeded') return { state: 'conflict', token: '' };
    // Missing expansion isn't proof that a reference doesn't exist. Retry later.
    if (!Object.hasOwn(order, 'fields')) return { state: 'unavailable', token: '' };
    return { ...mc2OrderReference(order), source: 'spiffy_order_fields' };
  } catch {
    return { state: 'unavailable', token: '' };
  }
}
