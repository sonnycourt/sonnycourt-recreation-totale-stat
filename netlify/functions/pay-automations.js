import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet, supabaseUpsert } from './lib/supabase-rest.mjs';

const RULE_KEY = 'failed_payment_first_reminder';
const DEFAULT_RULE = Object.freeze({
  rule_key: RULE_KEY,
  active: false,
  trigger_type: 'payment_failed',
  delay_minutes: 60,
  max_messages: 1,
  sender_email: '',
  subject_template: 'Ton paiement n’a pas pu être validé',
  body_template: 'Bonjour, ton dernier paiement n’a pas pu être validé. Merci de vérifier ton moyen de paiement ou de répondre à cet email si tu as besoin d’aide.',
});

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function clean(value, max = 2_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sameOrigin(req) {
  const origin = clean(req.headers.get('origin'), 500);
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

function normalizedRule(value = {}) {
  return {
    rule_key: RULE_KEY,
    active: Boolean(value.active),
    trigger_type: 'payment_failed',
    delay_minutes: Math.min(10_080, Math.max(0, Number(value.delay_minutes || 0))),
    max_messages: Math.min(3, Math.max(1, Number(value.max_messages || 1))),
    sender_email: clean(value.sender_email, 200).toLowerCase() || null,
    subject_template: clean(value.subject_template, 240) || DEFAULT_RULE.subject_template,
    body_template: clean(value.body_template, 2_000) || DEFAULT_RULE.body_template,
    updated_at: new Date().toISOString(),
    metadata: { pay_origin: 'sonnycourt_pay', provider_retries: 'stripe_paypal_native' },
  };
}

async function readRule() {
  const result = await supabaseGet(`pay_automation_rules?rule_key=eq.${RULE_KEY}&select=rule_key,active,trigger_type,delay_minutes,max_messages,sender_email,subject_template,body_template,updated_at&limit=1`);
  if (!result.ok) {
    const missing = result.status === 404 || result.error?.code === '42P01' || result.error?.code === 'PGRST205';
    if (missing) return { ready: false, rule: DEFAULT_RULE };
    throw new Error('pay_automation_read_failed');
  }
  return { ready: true, rule: Array.isArray(result.data) && result.data[0] ? result.data[0] : DEFAULT_RULE };
}

export default async (req) => {
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });
  if (req.method === 'GET') {
    try { return json(200, await readRule()); } catch { return json(502, { error: 'pay_automation_unavailable' }); }
  }
  if (req.method !== 'PUT') return json(405, { error: 'Méthode non autorisée' });
  if (!sameOrigin(req)) return json(403, { error: 'Origine non autorisée' });
  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Requête invalide' }); }
  if (clean(body?.confirmation, 40) !== 'CONFIRMER') return json(400, { error: 'Confirmation requise' });
  const rule = normalizedRule(body?.rule);
  if (rule.active && !clean(process.env.PAY_EMAIL_FROM || process.env.COACHING_EMAIL_FROM, 200)) {
    return json(409, { error: 'pay_email_sender_missing' });
  }
  const result = await supabaseUpsert('pay_automation_rules', rule, { onConflict: 'rule_key' });
  if (!result.ok) return json(result.status === 404 ? 503 : 502, { error: 'pay_automation_write_failed' });
  return json(200, { ok: true, ready: true, rule: Array.isArray(result.data) ? result.data[0] || rule : rule });
};
