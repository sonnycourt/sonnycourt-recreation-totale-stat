import { timingSafeEqual } from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { PAY_CATALOG_CONFIRMATIONS, preparePayCatalogCommand } from './lib/pay-catalog-command.mjs';
import { executePayCatalogCommand, payCatalogWriteState } from './lib/pay-catalog-executor.mjs';

function clean(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sameOrigin(req) {
  const origin = clean(req.headers.get('origin'), 300);
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

function sameFingerprint(first, second) {
  const left = Buffer.from(clean(first, 64));
  const right = Buffer.from(clean(second, 64));
  return left.length === 64 && right.length === 64 && timingSafeEqual(left, right);
}

function publicPlan(command, state) {
  return {
    kind: command.kind,
    flow: command.flow || null,
    fingerprint: command.fingerprint,
    confirmation: command.confirmation,
    writes_enabled: state.writes_enabled,
    stripe_mode: state.mode,
    operations: command.operations.map((operation) => ({ id: operation.id, stripe_method: operation.stripe_method })),
    schedule: command.schedule || null,
    continuation: command.continuation || null,
  };
}

function errorStatus(error) {
  if (Number(error?.status) >= 400 && Number(error.status) < 600) return Number(error.status);
  if (String(error?.message || '').startsWith('pay_catalog_')) return 400;
  return 502;
}

export default async (req) => {
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });
  const state = payCatalogWriteState();
  if (req.method === 'GET') return json(200, { connected: state.configured, ...state });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  if (!sameOrigin(req)) return json(403, { error: 'Origine non autorisée' });
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) return json(415, { error: 'Format non autorisé' });
  if (Number(req.headers.get('content-length') || 0) > 32_768) return json(413, { error: 'Requête trop volumineuse' });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Requête invalide' });
  const action = clean(body.action, 20).toLowerCase();
  const kind = clean(body.kind, 40).toLowerCase();
  if (!['preview', 'execute'].includes(action) || !PAY_CATALOG_CONFIRMATIONS[kind]) return json(400, { error: 'Commande invalide' });

  try {
    const command = preparePayCatalogCommand(kind, body.input || {}, {
      confirmation: action === 'preview' ? PAY_CATALOG_CONFIRMATIONS[kind] : clean(body.confirmation, 40),
      idempotencyKey: clean(body.idempotency_key, 100),
    });
    if (action === 'preview') return json(200, { ok: true, action: 'preview', plan: publicPlan(command, state) });
    if (!sameFingerprint(body.fingerprint, command.fingerprint)) return json(409, { error: 'pay_catalog_fingerprint_mismatch' });
    const result = await executePayCatalogCommand(command);
    console.info('pay-catalog-publish: completed', {
      kind: result.kind,
      flow: result.flow,
      mode: result.mode,
      operation_count: result.operations.length,
      fingerprint: result.fingerprint.slice(0, 12),
    });
    return json(200, { ok: true, action: 'execute', result });
  } catch (error) {
    const candidate = clean(error?.code || error?.message, 100);
    const code = /^(?:pay_catalog_|stripe_catalog_|stripe_)[a-z0-9_]+$/.test(candidate) ? candidate : 'pay_catalog_publish_failed';
    console.error('pay-catalog-publish:', { code, completed_operations: Number(error?.completed_operations || 0) });
    return json(errorStatus(error), { error: code, completed_operations: Number(error?.completed_operations || 0) });
  }
};
