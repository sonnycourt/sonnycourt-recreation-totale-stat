import crypto from 'crypto';
import { MC2_ENTRY_CHECKOUT_ID } from '../../src/lib/mc2-entry-payment.mjs';
import { confirmMc2EntryPayment } from './lib/mc2-entry-payment.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { sendTikTokEvent } from './lib/tiktok-capi.mjs';
import { sendMetaEvent } from './lib/meta-capi.mjs';
import { mc2LastKnownBrowserContext, mc2MetaEventId, sendMc2MetaEvents } from './lib/mc2-meta-events.mjs';
import { removeFromCheckoutAbandonGroup } from './lib/mailerlite-webinaire.mjs';
import { cancelMc2ReplayRecoveryJobs } from './lib/mc2-replay-recovery.mjs';
import { cancelMc2OfferSms } from './lib/mc2-sms.mjs';
import { cancelMc2OfferSmsAfterSpiffyPurchase } from './lib/mc2-spiffy-sms-cancellation.mjs';
import { excludeWebinarBuyer } from './lib/webinaire-exclusions.mjs';
import { mc2ConsultationBonusTag } from './lib/mc2-consultation-bonus.mjs';
import { mc2OrderReference, readMc2SpiffyIdentity } from './lib/mc2-spiffy-identity.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Vérifie la signature webhook (standard Svix / Standard Webhooks, préfixe whsec_).
 * Retourne 'ok' | 'invalid' | 'no_headers' (fail-open si en-têtes absents :
 * on ne veut pas perdre une vraie vente sur une hypothèse d'en-tête erronée).
 */
function verifySignature(rawBody, headers) {
  const secretRaw = process.env.SPIFFY_SIGNING_SECRET;
  if (!secretRaw) return 'no_secret';

  const id = headers.get('webhook-id') || headers.get('svix-id');
  const timestamp = headers.get('webhook-timestamp') || headers.get('svix-timestamp');
  const signature = headers.get('webhook-signature') || headers.get('svix-signature');
  if (!id || !timestamp || !signature) return 'no_headers';

  const key = Buffer.from(secretRaw.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');

  // L'en-tête peut contenir plusieurs signatures: "v1,xxx v1,yyy".
  const provided = signature.split(' ').map((p) => p.split(',').pop());
  const match = provided.some((sig) => {
    try {
      return (
        sig &&
        sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      );
    } catch {
      return false;
    }
  });
  return match ? 'ok' : 'invalid';
}

/** Cherche récursivement le 1er email dans l'objet (insensible à la structure). */
function findEmail(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') {
    const m = obj.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    return m ? obj : null;
  }
  if (typeof obj !== 'object') return null;
  // Clés probables d'abord.
  for (const k of ['email', 'customer_email', 'buyer_email']) {
    if (typeof obj[k] === 'string' && obj[k].includes('@')) return obj[k];
  }
  for (const v of Object.values(obj)) {
    const found = findEmail(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function findFirstKey(obj, keys, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const key of keys) {
    if (obj[key] != null && String(obj[key]).trim()) return String(obj[key]).trim();
  }
  for (const value of Object.values(obj)) {
    const found = findFirstKey(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Cherche récursivement l'affilié Spiffy dans le payload (id + nom).
 * Clés probables : affiliate_id / affiliateId / affiliate { id, name, ... }.
 */
function findAffiliate(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  const idKeys = ['affiliate_id', 'affiliateId', 'aff_id'];
  for (const k of idKeys) {
    if (obj[k] != null && String(obj[k]).trim() !== '') {
      const name = [obj.affiliate_name_first, obj.affiliate_name_last].filter(Boolean).join(' ')
        || obj.affiliate_name || null;
      return { id: String(obj[k]), name };
    }
  }
  if (obj.affiliate && typeof obj.affiliate === 'object') {
    const a = obj.affiliate;
    const id = a.id ?? a.affiliate_id;
    if (id != null) {
      const name = [a.name_first, a.name_last].filter(Boolean).join(' ') || a.name || null;
      return { id: String(id), name };
    }
  }
  for (const v of Object.values(obj)) {
    const found = findAffiliate(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Montant en euros depuis les champs Spiffy (les champs *_amount sont en centimes). */
function findAmountEur(data) {
  const centCandidates = [
    // v2 distinguishes today's charge from the complete installment contract.
    data?.detail?.due_today,
    data?.order_total,
    data?.display_total,
    data?.payment_amount,
    data?.payment_amount_paid,
    data?.payment_plan_amount,
    data?.subscription_amount,
    data?.amount_total,
  ];
  for (const c of centCandidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n / 100;
  }
  const euroCandidates = [data?.total, data?.amount, data?.grand_total, data?.subtotal];
  for (const c of euroCandidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n > 10000 ? n / 100 : n;
  }
  return null;
}

const MC2_SPIFFY_CHECKOUT_SLUGS = Object.freeze({
  monthly: [
    'esprit-subconscient-2-0-2-2-1',
    'esprit-subconscient-2-0-2-2-1-1',
  ],
  once: [
    'esprit-subconscient-2-0-34',
    'esprit-subconscient-2-0-34-1',
  ],
});

const MC2_SPIFFY_PLANS = Object.freeze({
  monthly: { initialCents: 76_700, contractualTotalCents: 230_100, paymentMode: 'spiffy_3x767' },
  once: { initialCents: 199_700, contractualTotalCents: 199_700, paymentMode: 'spiffy_one_time_1997' },
  twelve: { initialCents: 0, contractualTotalCents: 236_400, paymentMode: 'spiffy_j7_12x197' },
  six: { initialCents: 0, contractualTotalCents: 208_200, paymentMode: 'spiffy_j7_6x347' },
});

const MC2_SPIFFY_CHECKOUT_PLANS = Object.freeze({
  '40006': 'monthly',
  '40007': 'once',
  '40406': 'twelve',
  '40422': 'six',
});

/**
 * Événement Meta côté MC2 depuis un webhook de paiement : pas de requête
 * navigateur, donc on réutilise le dernier contexte connu (IP, user agent)
 * et la file durable prend le relais si Meta ne répond pas.
 */
async function sendMc2WebhookMetaEvent({ registration, eventName, eventId, contentName, value, currency = 'EUR', eventTime }) {
  if (!registration || registration.traffic_source !== 'meta_ad') return;
  try {
    const browser = await mc2LastKnownBrowserContext(registration.token);
    await sendMc2MetaEvents({
      events: [{ eventName, eventId, contentName }],
      registration,
      context: { ...browser, source: 'payment_webhook', url: 'https://sonnycourt.com/mc2/session/' },
      eventTime,
      durable: true,
      ...(typeof value === 'number' && Number.isFinite(value) ? { value, currency } : {}),
    });
  } catch (error) {
    // Meta ne doit jamais faire échouer un webhook de paiement.
    console.error('spiffy-webhook MC2 Meta event failed:', eventName, error?.message || error);
  }
}

function paymentEventId(kind, identity, token) {
  // Hash the full identity, never truncate a transaction ID or use today's date.
  return mc2MetaEventId(`spiffy-${kind}-${crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 32)}`, token);
}

function providerEventTime(body, data) {
  const stamp = data?.paid_at || data?.refunded_at || body?.created_at || data?.completed_at || data?.updated_at;
  const value = typeof stamp === 'number' ? stamp * 1000 : Date.parse(stamp || '');
  return Number.isFinite(value) ? Math.floor(value / 1000) : undefined;
}

async function isSubsequentSpiffyPayment(data, orderId, paymentId) {
  if (data?.is_initial_payment === true) return false;
  if (!orderId || !paymentId) return null;
  const ordinal = Number(data?.installment_number || data?.payment_number);
  if (ordinal > 0) return ordinal > 1;
  // A payment-success notification may also describe the initial charge.
  // Only a provider-confirmed earlier paid installment proves it is recurring.
  const key = process.env.SPIFFY_ONBOARDING_API_KEY;
  if (!key) return null;
  try {
    const url = new URL('https://api.spiffy.co/v2/payments');
    url.searchParams.set('filter[order_id]', orderId);
    url.searchParams.set('per_page', '100');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = await response.json();
    const payments = body.data;
    if (!Array.isArray(payments) || payments.length !== Number(body.meta?.pagination?.total_count ?? body.pagination?.total)) return null;
    const current = payments.find(p => String(p.id) === String(paymentId) && String(p.order_id) === String(orderId));
    if (!current) return null;
    const rootId = String(current.initial_payment_id || current.id);
    const root = payments.find(p => String(p.id) === rootId);
    if (!root) return null;
    return payments.some(p => String(p.order_id) === String(orderId)
      && String(p.initial_payment_id || p.id) !== rootId && Number(p.amount_paid) > 0
      && Date.parse(p.created_at) < Date.parse(root.created_at));
  } catch { return null; }
}

function amountMatches(actual, expected) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) < 0.02;
}

// 40006/40007 were repriced, not recreated. Match the received amount so that
// delayed historical orders keep their original terms instead of being repriced.
function mc2PlanPricing(planKey, amount) {
  if (planKey === 'monthly' && (amountMatches(amount, 197) || amountMatches(amount, 2364))) {
    return { initialCents: 19_700, contractualTotalCents: 236_400, paymentMode: 'spiffy_12x197' };
  }
  if (planKey === 'once' && amountMatches(amount, 1297)) {
    return { initialCents: 129_700, contractualTotalCents: 129_700, paymentMode: 'spiffy_one_time_1297' };
  }
  return MC2_SPIFFY_PLANS[planKey];
}

function mc2PlanFromPurchase(body, amount, registration, checkoutId) {
  const checkoutPlan = MC2_SPIFFY_CHECKOUT_PLANS[String(checkoutId || '')];
  if (checkoutPlan) return checkoutPlan;
  const haystack = JSON.stringify(body || {}).toLowerCase();
  if (MC2_SPIFFY_CHECKOUT_SLUGS.once.some((slug) => haystack.includes(slug))) return 'once';
  if (MC2_SPIFFY_CHECKOUT_SLUGS.monthly.some((slug) => haystack.includes(slug))) return 'monthly';

  const recentPlan = String(registration?.checkout_last_plan || '').toLowerCase();
  if (recentPlan === 'once' && (amountMatches(amount, 1997) || amountMatches(amount, 1297))) return 'once';
  if (['monthly', 'twelve'].includes(recentPlan) && [767, 2301, 197, 2364].some(value => amountMatches(amount, value))) return 'monthly';
  if (amountMatches(amount, 1997) || amountMatches(amount, 1297)) return 'once';
  if ([767, 2301, 197, 2364].some(value => amountMatches(amount, value))) return 'monthly';
  return null;
}

function mc2PurchaseBelongsToRegistration(body, registration, plan, checkoutId, payloadToken) {
  if (!registration || !plan) return false;
  if (payloadToken) return payloadToken === registration.token;

  if (MC2_SPIFFY_CHECKOUT_PLANS[String(checkoutId || '')]) return true;

  const haystack = JSON.stringify(body || {}).toLowerCase();
  if (Object.values(MC2_SPIFFY_CHECKOUT_SLUGS).flat().some((slug) => haystack.includes(slug))) return true;

  const viewedAt = Date.parse(registration.checkout_last_viewed_at || '');
  const viewedRecently = Number.isFinite(viewedAt) && Date.now() - viewedAt >= 0 && Date.now() - viewedAt <= 48 * 60 * 60 * 1000;
  return viewedRecently && String(registration.checkout_last_route || '').includes('/mc2/session');
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const rawBody = await req.text();

    // Vérification de signature Spiffy/Svix.
    const verdict = verifySignature(rawBody, req.headers);
    // 'invalid' : signature présente mais fausse -> falsification -> rejet.
    if (verdict === 'invalid') {
      console.warn('spiffy-webhook: signature invalide, rejet');
      return jsonResponse(401, { error: 'invalid_signature' });
    }
    // 'no_headers' : constaté en prod le 16/7 que Spiffy n'envoie PAS d'en-têtes
    // Svix — le rejet fail-closed du 9/7 perdait toutes les vraies ventes.
    // Fail-open + log des noms d'en-têtes reçus pour identifier le vrai
    // mécanisme de signature Spiffy et redurcir proprement ensuite.
    if (verdict === 'no_headers') {
      console.warn(
        'spiffy-webhook: en-têtes signature absents, fail-open. headers=%s',
        JSON.stringify([...req.headers.keys()]),
      );
    }
    // 'no_secret' : SPIFFY_SIGNING_SECRET n'est pas réglé en prod -> impossible de
    // vérifier. On accepte quand même pour ne perdre AUCUNE vraie vente, mais on
    // alerte : tant que ce secret n'est pas configuré, le webhook reste ouvert.
    if (verdict === 'no_secret') {
      console.error('spiffy-webhook: SPIFFY_SIGNING_SECRET absent — webhook NON verifie, a configurer');
    }

    let body = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }
    const data = body?.data?.object || body?.data || body;
    const eventType = String(
      body?.event || body?.event_name || body?.type || data?.event || data?.event_name || '',
    ).toLowerCase();
    const email = (findEmail(body) || '').trim().toLowerCase();
    // API v2 embeds the order in data.object and identifies its checkout by
    // checkout.id, not checkout_id. Never recursively match a generic id.
    const checkoutId = data?.checkout?.id != null
      ? String(data.checkout.id)
      : findFirstKey(body, ['checkout_id', 'checkoutId', 'checkout_uuid', 'offer_id']);
    const deferredPlan = ['twelve', 'six'].includes(MC2_SPIFFY_CHECKOUT_PLANS[String(checkoutId || '')]);
    // Masterclass entry is NOT an ES2 purchase. Exit before any ES2 automation.
    if (String(checkoutId) === MC2_ENTRY_CHECKOUT_ID) {
      if (eventType !== 'order:success' || !email || !data?.id) return jsonResponse(200, { ok: true, skipped: 'entry_non_success' });
      const lookup = await supabaseGet(`mc2_registrations?email=eq.${encodeURIComponent(email)}&select=*&limit=1`);
      if (!lookup.ok) return jsonResponse(503, { error: 'entry_registration_unavailable' });
      const entryRow = lookup.data?.[0];
      if (!entryRow) return jsonResponse(200, { ok: true, skipped: 'entry_no_registration' });
      // A webhook is not the customer's browser: never send Spiffy's IP/UA to Meta.
      const result = await confirmMc2EntryPayment(null, entryRow, { orderId: String(data.id) });
      return jsonResponse(result.paid || result.historical ? 200 : 503, { ok: result.paid, entry: true });
    }
    // J0 is a completed order, not an installment collected at J+7. Never
    // substitute the recurring price or the contractual total for today's 0 €.
    const paymentAmount = [data?.payment_amount_paid, data?.payment_amount, data?.amount_paid]
      .map(Number).find(n => Number.isFinite(n) && n > 0);
    const amount = deferredPlan && eventType === 'order:success' ? 0
      : eventType.startsWith('payment:') && paymentAmount ? paymentAmount / 100 : findAmountEur(data);

    // Log brut (1res ventes) pour affiner la structure réelle Spiffy si besoin.
    console.log('spiffy-webhook event=%s email=%s amount=%s', eventType || '?', email || 'none', amount ?? '?');

    if (!email) return jsonResponse(200, { ok: true, skipped: 'no_email' });

    const isRefund = eventType.includes('refund') || eventType.includes('chargeback') || eventType.includes('dispute');
    const isDispute = eventType.includes('chargeback') || eventType.includes('dispute');
    const isPaymentFailure = !isRefund && (eventType.includes('fail') || eventType.includes('declin'));
    const isSale = !isRefund && !isPaymentFailure && (deferredPlan
      ? eventType === 'order:success'
      : (eventType.includes('order:success') || eventType.includes('order') || eventType.includes('success')));
    const orderId = eventType.startsWith('order:') && data?.id != null
      ? String(data.id)
      : findFirstKey(body, ['order_id', 'orderId', 'order_uuid', 'transaction_id']);
    const paymentId = findFirstKey(data, ['payment_id', 'transaction_id'])
      || (eventType.startsWith('payment:') && data?.id != null ? String(data.id) : null);
    const eventTime = providerEventTime(body, data);
    if (deferredPlan && !isRefund && (!isSale || !orderId)) return jsonResponse(200, { ok: true, skipped: 'not_initial_order_success' });
    let identity = mc2OrderReference(body);
    // Current v2 notifications omit custom fields, even though the checkout
    // correctly persists MC2 Token on the order. Recover only that exact order.
    if (isSale && eventType === 'order:success' && identity.state === 'absent'
      && ['40006', '40007'].includes(String(checkoutId || ''))) {
      identity = await readMc2SpiffyIdentity({ orderId, checkoutId, email });
    }
    if (isSale && !eventType.startsWith('order:') && identity.state === 'absent' && orderId) {
      const owner = await supabaseGet(`mc2_funnel_events?dedupe_key=eq.${encodeURIComponent(`spiffy_order_${orderId}`)}&select=token&limit=2`);
      if (!owner.ok) return jsonResponse(503, { ok: false, error: 'purchase_record_unavailable' });
      if (owner.data?.length > 1) return jsonResponse(200, { ok: true, skipped: 'purchase_identity_ambiguous' });
      if (owner.data?.length === 1) identity = { state: 'valid', token: owner.data[0].token, source: 'recorded_order' };
    }
    if (isSale && identity.state === 'unavailable') {
      return jsonResponse(503, { ok: false, error: 'purchase_identity_unavailable' });
    }
    if (isSale && ['invalid', 'conflict'].includes(identity.state)) {
      console.warn('spiffy-webhook: identity rejected order=%s reason=%s', orderId, identity.state);
      return jsonResponse(200, { ok: true, skipped: `purchase_identity_${identity.state}` });
    }
    const payloadToken = identity.token;

    let reg = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,email,telephone,traffic_source,tt_click_id,meta_fbc,meta_fbp,checkout_last_plan,checkout_last_payment_mode,checkout_last_route&order=created_at.desc&limit=1`,
    );
    if (!reg.ok) {
      reg = await supabaseGet(
        `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,email,telephone,traffic_source,tt_click_id,meta_fbc,meta_fbp&order=created_at.desc&limit=1`,
      );
    }
    const row = reg.ok && Array.isArray(reg.data) ? reg.data[0] : null;

    let mc2Row = null;
    if (isSale) {
      const mc2Select = 'token,email,prenom,telephone,traffic_source,tt_click_id,meta_fbc,meta_fbp,session_starts_at,offer_expires_at,checkout_last_plan,checkout_last_payment_mode,checkout_last_route,checkout_last_viewed_at,payment_status,statut,purchased_at,purchase_bonus_tag';
      let mc2 = payloadToken
        ? await supabaseGet(
          `mc2_registrations?token=eq.${encodeURIComponent(payloadToken)}&select=${mc2Select}&limit=1`,
        )
        : { ok: true, data: [] };
      if (!payloadToken && mc2.ok && (!Array.isArray(mc2.data) || !mc2.data[0])) {
        mc2 = await supabaseGet(
          `mc2_registrations?email=eq.${encodeURIComponent(email)}`
            + `&select=${mc2Select}&order=registered_at.desc&limit=2`,
        );
      }
      if (!mc2.ok) return jsonResponse(503, { ok: false, error: 'purchase_registration_unavailable' });
      if (Array.isArray(mc2.data) && mc2.data.length > 1) {
        return jsonResponse(200, { ok: true, skipped: 'purchase_identity_ambiguous' });
      }
      mc2Row = mc2.ok && Array.isArray(mc2.data) ? mc2.data[0] : null;
      if (payloadToken && !mc2Row) return jsonResponse(200, { ok: true, skipped: 'purchase_reference_not_found' });
    }
    // Remboursement ou impayé : retrouver l'acheteur MC2 par email pour
    // informer Meta (audiences, reporting). Meta ne retire jamais un achat.
    let mc2BuyerRow = null;
    if ((isRefund || isPaymentFailure) && (!checkoutId || MC2_SPIFFY_CHECKOUT_PLANS[String(checkoutId)])
      && !['invalid', 'conflict', 'unavailable'].includes(identity.state)) {
      let buyerToken = payloadToken;
      if (!buyerToken && orderId) {
        const owner = await supabaseGet(`mc2_funnel_events?dedupe_key=eq.${encodeURIComponent(`spiffy_order_${orderId}`)}&select=token&limit=2`);
        if (owner.ok && owner.data?.length === 1) buyerToken = owner.data[0].token;
      }
      const buyers = !buyerToken && !checkoutId ? { ok: true, data: [] } : await supabaseGet(
        `mc2_registrations?${buyerToken ? 'token=eq.' + encodeURIComponent(buyerToken) : 'email=eq.' + encodeURIComponent(email)}&purchased_at=not.is.null`
          + '&select=token,email,telephone,traffic_source,meta_fbc,meta_fbp,optin_variant,purchased_at&order=purchased_at.desc&limit=2',
      );
      mc2BuyerRow = buyers.ok && Array.isArray(buyers.data) && buyers.data.length === 1 ? buyers.data[0] : null;
    }
    const mc2Plan = mc2PlanFromPurchase(body, amount, mc2Row, checkoutId);
    const isMc2Purchase = isSale
      && mc2PurchaseBelongsToRegistration(body, mc2Row, mc2Plan, checkoutId, payloadToken);

    if (isMc2Purchase && orderId) {
      const existing = await supabaseGet(`mc2_funnel_events?dedupe_key=eq.${encodeURIComponent(`spiffy_order_${orderId}`)}&select=token&limit=2`);
      if (!existing.ok) return jsonResponse(503, { ok: false, error: 'purchase_record_unavailable' });
      if (existing.data?.some(item => item.token !== mc2Row.token)) {
        return jsonResponse(200, { ok: true, skipped: 'purchase_order_already_linked' });
      }
    }

    if (!row && !isMc2Purchase && !mc2BuyerRow) return jsonResponse(200, { ok: true, skipped: 'lead_not_found' });

    const nowIso = new Date().toISOString();

    const firstMc2Purchase = isMc2Purchase && !mc2Row.purchased_at;
    if (isMc2Purchase && eventType.startsWith('order:') && eventType !== 'order:success') {
      return jsonResponse(200, { ok: true, type: 'ignored' });
    }
    // Un règlement ultérieur (mensualité) arrive avec un autre événement que
    // la commande initiale : il ne doit pas recompter un achat chez Meta.
    const installmentCandidate = isMc2Purchase && Boolean(mc2Row.purchased_at)
      && !eventType.startsWith('order:') && typeof amount === 'number' && amount > 0;
    const mc2Installment = installmentCandidate ? await isSubsequentSpiffyPayment(data, orderId, paymentId) : false;
    if (installmentCandidate && mc2Installment === null) {
      return jsonResponse(503, { ok: false, error: 'installment_verification_unavailable' });
    }
    if (isMc2Purchase && !eventType.startsWith('order:')) {
      if (mc2Installment) await sendMc2WebhookMetaEvent({
        registration: mc2Row, eventName: 'MC2_InstallmentPaid',
        eventId: paymentEventId('installment', data?.initial_payment_id || paymentId, mc2Row.token),
        contentName: 'Esprit Subconscient 2.0 - Mensualité', value: amount, eventTime,
      });
      // A recurring payment must not rewrite the initial purchase or its terms.
      return jsonResponse(200, { ok: true, type: mc2Installment ? 'installment' : 'ignored' });
    }
    if (isMc2Purchase) {
      const plan = mc2PlanPricing(mc2Plan, amount);
      const currentImmediatePlan = ['spiffy_12x197', 'spiffy_one_time_1297'].includes(plan.paymentMode);
      // Never infer accepted terms from webhook delivery time: old orders may
      // be replayed after a publication. Existing deduped events stay untouched.
      const reportedTermsVersion = String(data?.metadata?.terms_version || data?.terms_version || '');
      const acceptedTermsVersion = ['cgv-2026-09-v9', 'cgv-2026-09-v10'].includes(reportedTermsVersion)
        ? reportedTermsVersion : null;
      const purchasedAt = mc2Row.purchased_at || nowIso;
      if (deferredPlan || (currentImmediatePlan && orderId)) {
        // Reuse the existing server-only event store and its unique dedupe key.
        // Preserve the opt-in identity; the purchase email is immutable here.
        const purchaseEvent = await supabasePost('mc2_funnel_events', {
          token: mc2Row.token,
          event_name: 'purchase_completed',
          event_value: String(plan.initialCents / 100),
          page_path: '/spiffy-webhook',
          dedupe_key: `spiffy_order_${orderId}`,
          metadata: {
            provider: 'spiffy', order_id: orderId, checkout_id: checkoutId,
            purchase_email: email,
            identity_source: payloadToken ? (identity.source || 'webhook_order_reference') : 'exact_email',
            purchase_first_name: findFirstKey(body, ['name_first', 'first_name']) || mc2Row.prenom || '',
            plan: mc2Plan, payment_mode: plan.paymentMode,
            amount_cents: plan.initialCents, contractual_total_cents: plan.contractualTotalCents,
            terms_version: currentImmediatePlan ? acceptedTermsVersion : 'cgv-2026-09-v8',
            terms_version_source: currentImmediatePlan
              ? (acceptedTermsVersion ? 'provider_metadata' : 'provider_acceptance_to_verify') : 'historical_plan',
            terms_url: 'https://sonnycourt.com/cgv/',
          },
        });
        if (!purchaseEvent.ok && purchaseEvent.status !== 409) {
          return jsonResponse(503, { ok: false, error: 'purchase_record_unavailable' });
        }
        if (purchaseEvent.status === 409) {
          const owner = await supabaseGet(`mc2_funnel_events?dedupe_key=eq.${encodeURIComponent(`spiffy_order_${orderId}`)}&select=token&limit=2`);
          if (!owner.ok || owner.data?.length !== 1) return jsonResponse(503, { ok: false, error: 'purchase_record_unavailable' });
          if (owner.data[0].token !== mc2Row.token) return jsonResponse(200, { ok: true, skipped: 'purchase_order_already_linked' });
        }
      }
      const purchaseBonusTag = mc2ConsultationBonusTag({
        registration: mc2Row,
        purchasedAt,
      });
      // Identity/order claim is resolved first; the receipt precedes purchased_at
      // so a business-write retry cannot lose the advertising notification.
      if (firstMc2Purchase) await sendMc2WebhookMetaEvent({
        registration: mc2Row, eventName: 'Purchase', eventId: 'purchase-' + mc2Row.token,
        contentName: 'Esprit Subconscient 2.0', value: deferredPlan ? 0 : plan.initialCents / 100, eventTime,
      });
      const updatedMc2 = await supabasePatch(
        'mc2_registrations',
        `token=eq.${encodeURIComponent(mc2Row.token)}`,
        {
          statut: 'purchased',
          payment_status: 'paid',
          purchased_at: purchasedAt,
          purchase_bonus_tag: purchaseBonusTag,
          initial_payment_cents: plan.initialCents,
          contractual_total_cents: plan.contractualTotalCents,
          checkout_last_plan: mc2Plan,
          checkout_last_payment_mode: plan.paymentMode,
        },
      );
      if (!updatedMc2.ok) {
        console.error('spiffy-webhook: mise a jour MC2 impossible', updatedMc2.status, updatedMc2.error);
        if (deferredPlan || currentImmediatePlan) return jsonResponse(503, { ok: false, error: 'purchase_update_unavailable' });
      } else {
        await Promise.allSettled([
          cancelMc2OfferSms(mc2Row.token, 'purchase_completed'),
          cancelMc2ReplayRecoveryJobs({
            token: mc2Row.token,
            email: mc2Row.email,
            reason: 'purchase_completed',
          }),
        ]);
      }
    }

    // Resolve identity AND claim the order before any downstream side effects.
    if (isSale && mc2Row) {
      const cancellation = await cancelMc2OfferSmsAfterSpiffyPurchase({
        payload: body, checkoutId, email, token: mc2Row.token,
      });
      if (!cancellation.ok) console.error('spiffy-webhook MC2 SMS cancellation:', cancellation.error);
    }

    // --- Écriture cockpit historique ---
    if (row && isRefund) {
      // Le refund n'annule PAS la vente : purchased reste true.
      await supabasePatch('webinaire_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
        refunded: true,
        refunded_at: nowIso,
        ...(amount != null ? { refund_amount: amount } : {}),
      });
    } else if (row && isSale) {
      const affiliate = findAffiliate(body);
      await supabasePatch('webinaire_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
        purchased: true,
        purchased_at: nowIso,
        ...(amount != null ? { first_payment_amount: amount } : {}),
        ...(affiliate ? { purchase_affiliate_id: affiliate.id, purchase_affiliate_name: affiliate.name } : {}),
      });
    }

    if (isSale) {
      const registeredEmail = isMc2Purchase ? mc2Row.email : email;
      await removeFromCheckoutAbandonGroup(registeredEmail, process.env.MAILERLITE_API_KEY);
      const exclusion = await excludeWebinarBuyer(registeredEmail, 'acheteur_es');
      if (!exclusion.ok) console.error('spiffy-webhook: exclusion acheteur impossible', exclusion.status, exclusion.error);
    }

    if (row && (isSale || isRefund)) {
      const orderId = findFirstKey(body, ['order_id', 'orderId', 'order_uuid', 'transaction_id']);
      const checkoutId = findFirstKey(body, ['checkout_id', 'checkoutId', 'checkout_uuid', 'offer_id']);
      const eventName = isRefund ? 'refund_completed' : 'purchase_completed';
      const eventLog = await supabasePost(
        'rpc/record_webinaire_funnel_event',
        {
          p_token: row.token,
          p_event_name: eventName,
          p_metadata: {
            page_path: '/spiffy-webhook',
            route: row.checkout_last_route || '',
            plan: row.checkout_last_plan || '',
            payment_mode: row.checkout_last_payment_mode || '',
            amount_eur: amount,
            checkout_id: checkoutId,
            order_id: orderId,
          },
          p_dedupe_key: orderId ? `${eventName}_${orderId}` : null,
        },
        { prefer: 'return=representation' },
      );
      if (!eventLog.ok) {
        console.warn('spiffy-webhook funnel log unavailable:', eventLog.status, eventLog.error);
      }
    }

    // --- CAPI TikTok : seulement la VENTE d'un lead TikTok ---
    const attributionRow = row || (isMc2Purchase ? mc2Row : null);

    if (isSale && attributionRow?.traffic_source === 'tiktok_ad' && attributionRow.tt_click_id) {
      await sendTikTokEvent({
        eventName: 'CompletePayment',
        eventId: 'purchase-' + attributionRow.token, // même id que la détection MailerLite => dédup
        email: attributionRow.email,
        phone: attributionRow.telephone,
        ttclid: attributionRow.tt_click_id,
        value: deferredPlan ? 0 : amount || Number(process.env.TIKTOK_PURCHASE_VALUE_EUR) || 388,
        currency: 'EUR',
        contentName: 'Esprit Subconscient 2.0',
      });
    }

    // --- CAPI Meta : seulement la VENTE d'un lead Meta ---
    if (!isMc2Purchase && isSale && attributionRow?.traffic_source === 'meta_ad') {
      await sendMetaEvent({
        eventName: 'Purchase',
        eventId: 'purchase-' + attributionRow.token, // même id que la détection MailerLite => dédup
        email: attributionRow.email,
        phone: attributionRow.telephone,
        externalId: attributionRow.token,
        fbc: attributionRow.meta_fbc,
        fbp: attributionRow.meta_fbp,
        value: deferredPlan ? 0 : amount || Number(process.env.META_PURCHASE_VALUE_EUR) || 388,
        currency: 'EUR',
        contentName: 'Esprit Subconscient 2.0',
      });
    }

    if (mc2BuyerRow && isRefund && (paymentId || orderId || data?.refund_id)) {
      await sendMc2WebhookMetaEvent({
        registration: mc2BuyerRow,
        eventName: isDispute ? 'MC2_PaymentDisputed' : 'MC2_Refund',
        eventId: paymentEventId(isDispute ? 'dispute' : 'refund', data?.refund_id || `${paymentId || orderId}:${data?.amount_refunded || data?.refund_amount || amount}`, mc2BuyerRow.token),
        contentName: isDispute ? 'Esprit Subconscient 2.0 - Litige' : 'Esprit Subconscient 2.0 - Remboursement',
        eventTime,
        // amount_refunded can be cumulative; only an explicit refund amount
        // can safely be summed in reporting as this notification's value.
        ...(Number(data?.refund_amount) > 0 ? { value: Number(data.refund_amount) / 100 } : {}),
      });
    } else if (mc2BuyerRow && isPaymentFailure && (paymentId || orderId)) {
      await sendMc2WebhookMetaEvent({
        registration: mc2BuyerRow,
        eventName: 'MC2_PaymentFailed',
        eventId: paymentEventId('payment-failed', paymentId || body?.id || orderId, mc2BuyerRow.token),
        contentName: 'Esprit Subconscient 2.0 - Impayé',
        eventTime,
      });
    }

    return jsonResponse(200, { ok: true, type: isRefund ? 'refund' : isSale ? 'sale' : isPaymentFailure ? 'payment_failure' : 'ignored' });
  } catch (error) {
    console.error('spiffy-purchase-webhook error:', error);
    // 200 quand même : on ne veut pas que Spiffy retente en boucle.
    return jsonResponse(200, { ok: false });
  }
};
