import { supabaseGet, supabasePatch, supabaseUpsert } from './lib/supabase-rest.mjs';
import { scheduledJson } from './lib/scheduled-response.mjs';

function clean(value, max = 2_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function money(minor, currency) {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: clean(currency, 8).toUpperCase() || 'EUR' }).format(Number(minor || 0) / 100);
  } catch { return `${(Number(minor || 0) / 100).toFixed(2)} €`; }
}

function render(template, alert) {
  return clean(template, 4_000)
    .replaceAll('{{email}}', clean(alert.customer_email, 200))
    .replaceAll('{{amount}}', money(alert.amount_minor, alert.currency))
    .replaceAll('{{provider}}', alert.provider === 'stripe' ? 'Stripe' : 'PayPal');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function sendReminder(rule, alert) {
  const apiKey = clean(process.env.MAILERSEND_API_KEY, 500);
  const from = clean(rule.sender_email || process.env.PAY_EMAIL_FROM || process.env.COACHING_EMAIL_FROM, 200);
  if (!apiKey || !from) throw new Error('pay_email_not_configured');
  const subject = render(rule.subject_template, alert);
  const text = render(rule.body_template, alert);
  const response = await fetch('https://api.mailersend.com/v1/email', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: { email: from, name: process.env.PAY_EMAIL_FROM_NAME || 'Sonny Court' },
      to: [{ email: alert.customer_email }], subject,
      text, html: `<p>${escapeHtml(text).replaceAll('\n', '<br>')}</p>`,
    }),
  });
  if (!response.ok) throw new Error(`mailersend_${response.status}`);
}

export default async () => {
  const rules = await supabaseGet('pay_automation_rules?rule_key=eq.failed_payment_first_reminder&active=eq.true&select=*&limit=1');
  const rule = rules.ok && Array.isArray(rules.data) ? rules.data[0] : null;
  if (!rule) return scheduledJson({ ok: true, sent: 0, reason: 'rule_disabled' });
  const alertsResult = await supabaseGet('pay_alerts?alert_type=eq.payment_failed&status=eq.open&customer_email=not.is.null&select=provider,external_id,customer_email,amount_minor,currency,occurred_at&order=occurred_at.asc&limit=100');
  if (!alertsResult.ok) throw new Error('pay_alerts_unavailable');
  const threshold = Date.now() - Math.max(0, Number(rule.delay_minutes || 0)) * 60_000;
  const alerts = (alertsResult.data || []).filter((item) => new Date(item.occurred_at || 0).getTime() <= threshold);
  let sent = 0;
  for (const alert of alerts) {
    const recipient = clean(alert.customer_email, 200).toLowerCase();
    if (!recipient) continue;
    const reservation = await supabaseUpsert('pay_email_deliveries', {
      rule_id: rule.id, provider: alert.provider, external_event_id: alert.external_id,
      recipient_email: recipient, status: 'pending', scheduled_at: new Date().toISOString(),
      metadata: { pay_origin: 'sonnycourt_pay' },
    }, { onConflict: 'rule_id,provider,external_event_id,recipient_email', prefer: 'resolution=ignore-duplicates,return=representation' });
    const row = reservation.ok && Array.isArray(reservation.data) ? reservation.data[0] : null;
    if (!row?.id) continue;
    try {
      await sendReminder(rule, alert);
      await supabasePatch('pay_email_deliveries', `id=eq.${encodeURIComponent(row.id)}`, { status: 'sent', sent_at: new Date().toISOString(), error_code: null });
      sent += 1;
    } catch (error) {
      await supabasePatch('pay_email_deliveries', `id=eq.${encodeURIComponent(row.id)}`, { status: 'failed', error_code: clean(error?.message, 160) || 'email_failed' });
    }
  }
  return scheduledJson({ ok: true, sent, inspected: alerts.length });
};
