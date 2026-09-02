import crypto from 'crypto';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { sendTikTokEvent } from './lib/tiktok-capi.mjs';
import { sendMetaEvent } from './lib/meta-capi.mjs';
import { removeFromCheckoutAbandonGroup } from './lib/mailerlite-webinaire.mjs';
import { cancelMc2ReplayRecoveryJobs } from './lib/mc2-replay-recovery.mjs';
import { cancelMc2OfferSms } from './lib/mc2-sms.mjs';
import { cancelMc2OfferSmsAfterSpiffyPurchase } from './lib/mc2-spiffy-sms-cancellation.mjs';
import { excludeWebinarBuyer } from './lib/webinaire-exclusions.mjs';

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
    data?.order_total,
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

function cleanMc2Token(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9_-]{16,160}$/.test(token) ? token : '';
}

function findMc2Token(body) {
  return cleanMc2Token(findFirstKey(body, ['mc2_token', 'registration_token', 'client_reference_id']));
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
});

const MC2_SPIFFY_CHECKOUT_PLANS = Object.freeze({
  '40006': 'monthly',
  '40007': 'once',
});

function amountMatches(actual, expected) {
  return Number.isFinite(Number(actual)) && Math.abs(Number(actual) - expected) < 0.02;
}

function mc2PlanFromPurchase(body, amount, registration, checkoutId) {
  const checkoutPlan = MC2_SPIFFY_CHECKOUT_PLANS[String(checkoutId || '')];
  if (checkoutPlan) return checkoutPlan;
  const haystack = JSON.stringify(body || {}).toLowerCase();
  if (MC2_SPIFFY_CHECKOUT_SLUGS.once.some((slug) => haystack.includes(slug))) return 'once';
  if (MC2_SPIFFY_CHECKOUT_SLUGS.monthly.some((slug) => haystack.includes(slug))) return 'monthly';

  const recentPlan = String(registration?.checkout_last_plan || '').toLowerCase();
  if (recentPlan === 'once' && amountMatches(amount, 1997)) return 'once';
  if (recentPlan === 'monthly' && (amountMatches(amount, 767) || amountMatches(amount, 2301))) return 'monthly';
  if (amountMatches(amount, 1997)) return 'once';
  if (amountMatches(amount, 767) || amountMatches(amount, 2301)) return 'monthly';
  return null;
}

function mc2PurchaseBelongsToRegistration(body, registration, plan, checkoutId) {
  if (!registration || !plan) return false;
  const payloadToken = findMc2Token(body);
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
    const data = body?.data || body;
    const eventType = String(
      body?.event || body?.event_name || body?.type || data?.event || data?.event_name || '',
    ).toLowerCase();
    const email = (findEmail(body) || '').trim().toLowerCase();
    const amount = findAmountEur(data);

    // Log brut (1res ventes) pour affiner la structure réelle Spiffy si besoin.
    console.log('spiffy-webhook event=%s email=%s amount=%s', eventType || '?', email || 'none', amount ?? '?');

    if (!email) return jsonResponse(200, { ok: true, skipped: 'no_email' });

    const isRefund = eventType.includes('refund');
    const isSale = !isRefund && (eventType.includes('order:success') || eventType.includes('order') || eventType.includes('success'));
    const orderId = findFirstKey(body, ['order_id', 'orderId', 'order_uuid', 'transaction_id']);
    const checkoutId = findFirstKey(body, ['checkout_id', 'checkoutId', 'checkout_uuid', 'offer_id']);
    const payloadToken = findMc2Token(body);

    // Le webhook historique continue de traiter webinaire_registrations plus bas.
    // Cette branche additionnelle coupe uniquement le SMS H-4 du nouveau funnel
    // MC2 quand Spiffy confirme une vente de l'un de ses deux checkouts dédiés.
    if (isSale) {
      const cancellation = await cancelMc2OfferSmsAfterSpiffyPurchase({
        payload: body,
        checkoutId,
        email,
        token: payloadToken,
      });
      if (!cancellation.ok) {
        console.error('spiffy-webhook MC2 SMS cancellation:', cancellation.error);
      }
    }

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
      const mc2Select = 'token,email,prenom,telephone,traffic_source,tt_click_id,meta_fbc,meta_fbp,checkout_last_plan,checkout_last_payment_mode,checkout_last_route,checkout_last_viewed_at,payment_status,statut,purchased_at';
      let mc2 = payloadToken
        ? await supabaseGet(
          `mc2_registrations?token=eq.${encodeURIComponent(payloadToken)}&select=${mc2Select}&limit=1`,
        )
        : { ok: true, data: [] };
      if (!payloadToken && mc2.ok && (!Array.isArray(mc2.data) || !mc2.data[0])) {
        mc2 = await supabaseGet(
          `mc2_registrations?email=eq.${encodeURIComponent(email)}`
            + `&select=${mc2Select}&order=registered_at.desc&limit=1`,
        );
      }
      mc2Row = mc2.ok && Array.isArray(mc2.data) ? mc2.data[0] : null;
    }
    const mc2Plan = mc2PlanFromPurchase(body, amount, mc2Row, checkoutId);
    const isMc2Purchase = isSale
      && mc2PurchaseBelongsToRegistration(body, mc2Row, mc2Plan, checkoutId);
    if (!row && !isMc2Purchase) return jsonResponse(200, { ok: true, skipped: 'lead_not_found' });

    const nowIso = new Date().toISOString();

    // --- Écriture cockpit (TOUS les leads, organique + pub) ---
    if (row && isRefund) {
      // Le refund n'annule PAS la vente : purchased reste true.
      await supabasePatch('webinaire_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
        refunded: true,
        refunded_at: nowIso,
        ...(amount != null ? { refund_amount: amount } : {}),
      });
    } else if (row && isSale) {
      // Achat confirmé → sortie du groupe CHECKOUT-ABANDON (coupe la relance).
      // Affilié Spiffy = source de vérité pour l'attribution des ventes closers.
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
      if (!exclusion.ok) {
        console.error('spiffy-webhook: exclusion acheteur impossible', exclusion.status, exclusion.error);
      }
    }

    if (isMc2Purchase) {
      const plan = MC2_SPIFFY_PLANS[mc2Plan];
      const purchasedAt = mc2Row.purchased_at || nowIso;
      const updatedMc2 = await supabasePatch(
        'mc2_registrations',
        `token=eq.${encodeURIComponent(mc2Row.token)}`,
        {
          statut: 'purchased',
          payment_status: 'paid',
          purchased_at: purchasedAt,
          initial_payment_cents: plan.initialCents,
          contractual_total_cents: plan.contractualTotalCents,
          checkout_last_plan: mc2Plan,
          checkout_last_payment_mode: plan.paymentMode,
        },
      );
      if (!updatedMc2.ok) {
        console.error('spiffy-webhook: mise a jour MC2 impossible', updatedMc2.status, updatedMc2.error);
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
        value: amount || Number(process.env.TIKTOK_PURCHASE_VALUE_EUR) || 388,
        currency: 'EUR',
        contentName: 'Esprit Subconscient 2.0',
      });
    }

    // --- CAPI Meta : seulement la VENTE d'un lead Meta ---
    if (isSale && attributionRow?.traffic_source === 'meta_ad') {
      await sendMetaEvent({
        eventName: 'Purchase',
        eventId: 'purchase-' + attributionRow.token, // même id que la détection MailerLite => dédup
        email: attributionRow.email,
        phone: attributionRow.telephone,
        fbc: attributionRow.meta_fbc,
        fbp: attributionRow.meta_fbp,
        value: amount || Number(process.env.META_PURCHASE_VALUE_EUR) || 388,
        currency: 'EUR',
        contentName: 'Esprit Subconscient 2.0',
      });
    }

    return jsonResponse(200, { ok: true, type: isRefund ? 'refund' : isSale ? 'sale' : 'ignored' });
  } catch (error) {
    console.error('spiffy-purchase-webhook error:', error);
    // 200 quand même : on ne veut pas que Spiffy retente en boucle.
    return jsonResponse(200, { ok: false });
  }
};
