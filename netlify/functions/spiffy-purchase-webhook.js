import { supabaseGet } from './lib/supabase-rest.mjs';
import { sendTikTokEvent } from './lib/tiktok-capi.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

  // Sécurité optionnelle : ?key=<SPIFFY_WEBHOOK_SECRET>
  const secret = process.env.SPIFFY_WEBHOOK_SECRET;
  if (secret) {
    const url = new URL(req.url);
    if (url.searchParams.get('key') !== secret) {
      return jsonResponse(401, { error: 'unauthorized' });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const data = body?.data || body;
    const email = (findEmail(body) || '').trim().toLowerCase();

    // Log brut (1res ventes) pour affiner si besoin la structure réelle Spiffy.
    console.log('spiffy-webhook event=%s email=%s', body?.event || body?.type || '?', email || 'none');

    if (!email) return jsonResponse(200, { ok: true, skipped: 'no_email' });

    const reg = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,email,telephone,traffic_source,tt_click_id&limit=1`,
    );
    const row = reg.ok && Array.isArray(reg.data) ? reg.data[0] : null;

    if (!row || row.traffic_source !== 'tiktok_ad' || !row.tt_click_id) {
      return jsonResponse(200, { ok: true, skipped: 'not_tiktok_lead' });
    }

    const value = findAmountEur(data) || Number(process.env.TIKTOK_PURCHASE_VALUE_EUR) || 388;

    await sendTikTokEvent({
      eventName: 'CompletePayment',
      eventId: 'purchase-' + row.token, // même id que la détection MailerLite => dédup
      email: row.email,
      phone: row.telephone,
      ttclid: row.tt_click_id,
      value,
      currency: 'EUR',
      contentName: 'Esprit Subconscient 2.0',
    });

    return jsonResponse(200, { ok: true, sent: true });
  } catch (error) {
    console.error('spiffy-purchase-webhook error:', error);
    // 200 quand même : on ne veut pas que Spiffy retente en boucle.
    return jsonResponse(200, { ok: false });
  }
};
