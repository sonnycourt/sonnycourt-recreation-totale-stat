import crypto from 'crypto';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import { sendTikTokEvent } from './lib/tiktok-capi.mjs';
import { sendMetaEvent } from './lib/meta-capi.mjs';

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

/** Montant en euros depuis champs probables (gère cents si > 10000). */
function findAmountEur(data) {
  const candidates = [data?.total, data?.amount, data?.amount_total, data?.grand_total, data?.subtotal];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n > 10000 ? n / 100 : n;
  }
  return null;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const rawBody = await req.text();

    // Vérification de signature Spiffy/Svix.
    const verdict = verifySignature(rawBody, req.headers);
    // Sécurité : on rejette tout ce qui n'est pas une vraie signature Spiffy.
    // - 'invalid'    : signature présente mais fausse -> falsification -> rejet.
    // - 'no_headers' : un secret est configuré mais l'appel n'apporte aucune
    //   signature. Spiffy (Svix / Standard Webhooks) envoie TOUJOURS ses en-têtes
    //   sur une vraie vente, donc une absence = appel forgé -> rejet.
    if (verdict === 'invalid' || verdict === 'no_headers') {
      console.warn('spiffy-webhook: signature %s, rejet', verdict);
      return jsonResponse(401, { error: 'invalid_signature' });
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
    const eventType = String(body?.event || body?.type || data?.event || '').toLowerCase();
    const email = (findEmail(body) || '').trim().toLowerCase();
    const amount = findAmountEur(data);

    // Log brut (1res ventes) pour affiner la structure réelle Spiffy si besoin.
    console.log('spiffy-webhook event=%s email=%s amount=%s', eventType || '?', email || 'none', amount ?? '?');

    if (!email) return jsonResponse(200, { ok: true, skipped: 'no_email' });

    const isRefund = eventType.includes('refund');
    const isSale = !isRefund && (eventType.includes('order:success') || eventType.includes('order') || eventType.includes('success'));

    const reg = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,email,telephone,traffic_source,tt_click_id,meta_fbc,meta_fbp&limit=1`,
    );
    const row = reg.ok && Array.isArray(reg.data) ? reg.data[0] : null;
    if (!row) return jsonResponse(200, { ok: true, skipped: 'lead_not_found' });

    const nowIso = new Date().toISOString();

    // --- Écriture cockpit (TOUS les leads, organique + pub) ---
    if (isRefund) {
      // Le refund n'annule PAS la vente : purchased reste true.
      await supabasePatch('webinaire_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
        refunded: true,
        refunded_at: nowIso,
        ...(amount != null ? { refund_amount: amount } : {}),
      });
    } else if (isSale) {
      // Affilié Spiffy = source de vérité pour l'attribution des ventes closers.
      const affiliate = findAffiliate(body);
      await supabasePatch('webinaire_registrations', `token=eq.${encodeURIComponent(row.token)}`, {
        purchased: true,
        purchased_at: nowIso,
        ...(amount != null ? { first_payment_amount: amount } : {}),
        ...(affiliate ? { purchase_affiliate_id: affiliate.id, purchase_affiliate_name: affiliate.name } : {}),
      });
    }

    // --- CAPI TikTok : seulement la VENTE d'un lead TikTok ---
    if (isSale && row.traffic_source === 'tiktok_ad' && row.tt_click_id) {
      await sendTikTokEvent({
        eventName: 'CompletePayment',
        eventId: 'purchase-' + row.token, // même id que la détection MailerLite => dédup
        email: row.email,
        phone: row.telephone,
        ttclid: row.tt_click_id,
        value: amount || Number(process.env.TIKTOK_PURCHASE_VALUE_EUR) || 388,
        currency: 'EUR',
        contentName: 'Esprit Subconscient 2.0',
      });
    }

    // --- CAPI Meta : seulement la VENTE d'un lead Meta ---
    if (isSale && row.traffic_source === 'meta_ad') {
      await sendMetaEvent({
        eventName: 'Purchase',
        eventId: 'purchase-' + row.token, // même id que la détection MailerLite => dédup
        email: row.email,
        phone: row.telephone,
        fbc: row.meta_fbc,
        fbp: row.meta_fbp,
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
