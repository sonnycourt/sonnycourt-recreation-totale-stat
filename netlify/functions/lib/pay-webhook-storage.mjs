import { supabaseGet, supabasePatch, supabaseUpsert } from './supabase-rest.mjs';

const WRITABLE_TABLES = new Set([
  'pay_alerts', 'pay_checkouts', 'pay_customers', 'pay_discounts', 'pay_disputes',
  'pay_orders', 'pay_payment_plans', 'pay_payments', 'pay_prices', 'pay_products',
  'pay_refunds', 'pay_subscriptions',
]);

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function encode(value) {
  return encodeURIComponent(clean(value, 500));
}

function storageError(code, result) {
  const error = new Error(code);
  error.status = result?.status || 500;
  error.details = result?.error || null;
  return error;
}

async function existingWebhook(envelope, adapters) {
  const result = await adapters.get(`pay_webhook_events?select=status,attempts&provider=eq.${encode(envelope.provider)}&event_id=eq.${encode(envelope.event_id)}&limit=1`);
  if (!result.ok) throw storageError('pay_webhook_lookup_failed', result);
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function markWebhook(envelope, body, adapters) {
  const query = `provider=eq.${encode(envelope.provider)}&event_id=eq.${encode(envelope.event_id)}`;
  const result = await adapters.patch('pay_webhook_events', query, body);
  if (!result.ok) throw storageError('pay_webhook_status_failed', result);
}

export async function storePreparedPayWebhook(prepared, options = {}) {
  const adapters = {
    get: options.get || supabaseGet,
    patch: options.patch || supabasePatch,
    upsert: options.upsert || supabaseUpsert,
  };
  const envelope = prepared?.envelope;
  if (!envelope?.provider || !envelope?.event_id) throw new Error('pay_webhook_storage_envelope_invalid');
  const existing = await existingWebhook(envelope, adapters);
  if (existing?.status === 'completed' || existing?.status === 'skipped') {
    return { duplicate: true, status: existing.status, operations: 0 };
  }

  const accepted = await adapters.upsert('pay_webhook_events', {
    ...envelope,
    status: 'processing',
    attempts: Math.max(0, Number(existing?.attempts || 0)) + 1,
  }, { onConflict: 'provider,event_id' });
  if (!accepted.ok) throw storageError('pay_webhook_accept_failed', accepted);

  try {
    let written = 0;
    for (const operation of prepared.operations || []) {
      if (!WRITABLE_TABLES.has(operation?.table) || operation?.conflict !== 'provider,external_id') {
        throw new Error('pay_webhook_operation_invalid');
      }
      const result = await adapters.upsert(operation.table, operation.row, { onConflict: operation.conflict });
      if (!result.ok) throw storageError(`pay_webhook_write_failed:${operation.table}`, result);
      written += 1;
    }
    const status = written || (prepared.effects || []).length ? 'completed' : 'skipped';
    await markWebhook(envelope, { status, processed_at: new Date().toISOString(), error_code: null }, adapters);
    return { duplicate: false, status, operations: written, deferred_effects: (prepared.effects || []).length };
  } catch (error) {
    await markWebhook(envelope, {
      status: 'failed', processed_at: new Date().toISOString(), error_code: clean(error?.message, 180) || 'pay_webhook_failed',
    }, adapters).catch(() => {});
    throw error;
  }
}
