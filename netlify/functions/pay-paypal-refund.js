import crypto from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { cleanPayPalValue, getPayPalConfig, paypalRequest } from './lib/pay-paypal.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sameOrigin(req) {
  const origin = cleanPayPalValue(req.headers.get('origin'), 300);
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

function currencyDigits(currency) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });
  if (!sameOrigin(req)) return json(403, { error: 'Origine non autorisée' });
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json')) return json(415, { error: 'Format non autorisé' });

  const body = await req.json().catch(() => ({}));
  const captureId = cleanPayPalValue(body.capture_id, 80);
  const currency = cleanPayPalValue(body.currency, 3).toUpperCase();
  const amount = Number(body.amount);
  const confirmation = cleanPayPalValue(body.confirmation, 40);
  if (!/^[A-Za-z0-9-]{6,80}$/.test(captureId)) return json(400, { error: 'Paiement PayPal invalide' });
  if (!/^[A-Z]{3}$/.test(currency)) return json(400, { error: 'Devise invalide' });
  if (!Number.isSafeInteger(amount) || amount <= 0) return json(400, { error: 'Montant invalide' });
  if (confirmation !== 'REMBOURSER PAYPAL') return json(400, { error: 'Confirmation requise' });

  const config = getPayPalConfig();
  if (config.mode === 'live' && process.env.PAYPAL_LIVE_WRITES_ENABLED !== 'true') {
    return json(403, { error: 'paypal_writes_disabled' });
  }

  try {
    const capture = await paypalRequest(`/v2/payments/captures/${encodeURIComponent(captureId)}`);
    if (!['COMPLETED', 'PARTIALLY_REFUNDED'].includes(capture.status)) return json(409, { error: 'Paiement PayPal non remboursable' });
    const capturedCurrency = cleanPayPalValue(capture.amount?.currency_code, 3).toUpperCase();
    const capturedMinor = Math.round(Number(capture.amount?.value || 0) * (10 ** currencyDigits(capturedCurrency)));
    if (capturedCurrency !== currency || amount > capturedMinor) return json(409, { error: 'Montant supérieur au paiement PayPal' });

    const divisor = 10 ** currencyDigits(currency);
    const nonce = cleanPayPalValue(body.idempotency_key, 80) || crypto.randomUUID();
    const refund = await paypalRequest(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      method: 'POST',
      requestId: `pay-refund-${captureId}-${nonce}`.slice(0, 100),
      body: {
        amount: { value: (amount / divisor).toFixed(currencyDigits(currency)), currency_code: currency },
        note_to_payer: 'Remboursement demandé depuis Sonny Court Pay.',
      },
    });
    console.info('pay-paypal-refund: created', { refund_id: cleanPayPalValue(refund.id, 80), capture_id: captureId, amount, currency, mode: config.mode });
    return json(200, { ok: true, refund: { id: cleanPayPalValue(refund.id, 80), status: cleanPayPalValue(refund.status, 40), amount, currency: currency.toLowerCase(), capture_id: captureId } });
  } catch (error) {
    console.error('pay-paypal-refund:', cleanPayPalValue(error?.message, 100));
    const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? 409 : 502;
    return json(status, { error: 'paypal_refund_failed', code: cleanPayPalValue(error?.code, 80) || null });
  }
};
