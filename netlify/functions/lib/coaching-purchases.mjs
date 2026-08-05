import crypto from 'crypto';
import { coachingAppUrl } from './coaching-origin.mjs';
import { sendCoachingActivationEmail } from './coaching-integrations.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';

export async function deliverCoachingPurchaseActivation({ purchase, offerSlug }) {
  const clientResult = await supabaseGet(
    `coaching_clients?id=eq.${encodeURIComponent(purchase.client_id)}&select=id,email,first_name,auth_user_id&limit=1`,
  );
  const client = clientResult.ok && Array.isArray(clientResult.data) ? clientResult.data[0] : null;
  if (!client) throw new Error('coaching_client_missing');
  if (client.auth_user_id) return { status: 'existing_account' };

  const deliveredResult = await supabaseGet(
    `coaching_email_deliveries?order_id=eq.${encodeURIComponent(purchase.order_id)}` +
    `&kind=eq.account_activation&recipient_email=eq.${encodeURIComponent(client.email)}&status=eq.sent&select=id&limit=1`,
  );
  if (!deliveredResult.ok) throw new Error(`coaching_activation_delivery_check_${deliveredResult.status}`);
  if (Array.isArray(deliveredResult.data) && deliveredResult.data[0]) return { status: 'already_sent' };
  if (!process.env.MAILERSEND_API_KEY || !process.env.COACHING_EMAIL_FROM) throw new Error('coaching_activation_email_not_configured');

  let credits = Number(purchase.credits_added || 0);
  if (!credits) {
    const orderResult = await supabaseGet(
      `coaching_orders?id=eq.${encodeURIComponent(purchase.order_id)}&select=id,coaching_offers(sessions_count)&limit=1`,
    );
    const order = orderResult.ok && Array.isArray(orderResult.data) ? orderResult.data[0] : null;
    credits = Number(order?.coaching_offers?.sessions_count || 0);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const closed = await supabasePatch(
    'coaching_account_activations',
    `client_id=eq.${encodeURIComponent(client.id)}&used_at=is.null`,
    { used_at: new Date().toISOString() },
  );
  if (!closed.ok) throw new Error(`coaching_activation_close_${closed.status}`);
  const activation = await supabasePost('coaching_account_activations', {
    client_id: client.id,
    order_id: purchase.order_id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (!activation.ok) throw new Error(`coaching_activation_${activation.status}`);

  const delivery = await sendCoachingActivationEmail({
    email: client.email,
    firstName: client.first_name,
    activationUrl: coachingAppUrl(`/activer?token=${encodeURIComponent(token)}`),
    credits,
    firstConsultation: offerSlug === 'first-consultation',
  });
  if (delivery.status !== 'sent') throw new Error(`coaching_activation_email_${delivery.status}`);
  const logged = await supabasePost('coaching_email_deliveries', {
    order_id: purchase.order_id,
    client_id: client.id,
    kind: 'account_activation',
    recipient_email: client.email,
    provider: 'mailersend',
    status: 'sent',
  });
  if (!logged.ok && logged.status !== 409) throw new Error(`coaching_activation_delivery_log_${logged.status}`);
  return { status: 'sent' };
}
