import { supabaseGet } from './supabase-rest.mjs';
import { cancelMc2OfferSms } from './mc2-sms.mjs';

const DEFAULT_MC2_SPIFFY_CHECKOUT_IDS = Object.freeze([
  '40006', // 3 mensualités de 767 €
  '40007', // paiement unique de 1 997 €
  '39495', // anciens checkouts conservés pour les événements retardés
  '39498',
]);
const MC2_SPIFFY_SLUGS = Object.freeze([
  'esprit-subconscient-2-0-2-2-1',
  'esprit-subconscient-2-0-2-2-1-1',
  'esprit-subconscient-2-0-34',
  'esprit-subconscient-2-0-34-1',
]);

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function mc2SpiffyCheckoutIds(env = process.env) {
  const configured = clean(env.SPIFFY_MC2_CHECKOUT_IDS, 1_000);
  return new Set((configured ? configured.split(',') : DEFAULT_MC2_SPIFFY_CHECKOUT_IDS)
    .map((value) => clean(value, 80))
    .filter(Boolean));
}

export function isMc2SpiffyCheckout({ checkoutId, payload, env = process.env } = {}) {
  const id = clean(checkoutId, 80);
  if (id && mc2SpiffyCheckoutIds(env).has(id)) return true;
  let serialized = '';
  try { serialized = JSON.stringify(payload || {}).toLowerCase(); } catch { return false; }
  return MC2_SPIFFY_SLUGS.some((slug) => serialized.includes(slug));
}

export async function cancelMc2OfferSmsAfterSpiffyPurchase({
  payload,
  checkoutId,
  email,
  token,
  env = process.env,
} = {}) {
  const normalizedEmail = clean(email, 320).toLowerCase();
  const normalizedToken = clean(token, 160);
  if ((!normalizedToken && !normalizedEmail) || !isMc2SpiffyCheckout({ checkoutId, payload, env })) {
    return { ok: true, skipped: 'not_mc2' };
  }
  let lookup = normalizedToken
    ? await supabaseGet(
      `mc2_registrations?token=eq.${encodeURIComponent(normalizedToken)}&select=token&limit=1`,
    )
    : { ok: true, data: [] };
  if (!normalizedToken && lookup.ok && (!Array.isArray(lookup.data) || !lookup.data[0]) && normalizedEmail) {
    lookup = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(normalizedEmail)}`
        + '&select=token&order=registered_at.desc&limit=1',
    );
  }
  if (!lookup.ok) return { ok: false, error: 'mc2_registration_lookup_failed' };
  const registration = Array.isArray(lookup.data) ? lookup.data[0] : null;
  if (!registration?.token) return { ok: true, skipped: 'mc2_registration_missing' };
  const cancelled = await cancelMc2OfferSms(registration.token, 'spiffy_purchase_completed');
  return cancelled.ok
    ? { ok: true, token: registration.token, cancelled: true }
    : { ok: false, error: 'mc2_offer_sms_cancellation_failed' };
}
