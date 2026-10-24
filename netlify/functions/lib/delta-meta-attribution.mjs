// Attribution Meta des leads Delta Vision venus d'une pub.
// Netlify Blobs `delta-meta-attribution-v1` : clé = SHA-256 de l'email, valeur = fbc/fbp/UTM/eventId.
// Aucun schéma Supabase. Purge à 30 jours. Rien ne bloque jamais l'inscription ni le webhook d'achat.
import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { sendMetaEvent } from './meta-capi.mjs';

export const META_ATTRIBUTION_TTL_MS = 30 * 86400000;
export const DELTA_CHECKOUT_PRICES = Object.freeze({ '41037': 97, '41049': 97, '41096': 147 });
export const attributionStore = () => getStore({ name: 'delta-meta-attribution-v1', consistency: 'strong' });
export const emailKey = email => createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const label = (value, max = 100) => typeof value === 'string' && /^[\p{L}\p{N} ._:/-]*$/u.test(value) ? value.slice(0, max) : '';
const PAGE_URL = 'https://sonnycourt.com/delta-vision/';

/** Valide ce que le navigateur envoie. null = pas une attribution Meta exploitable. */
export function cleanMetaAttribution(input) {
  if (!input || typeof input !== 'object') return null;
  const eventId = uuid(input.eventId) ? input.eventId.toLowerCase() : '';
  const source = label(String(input.source || ''), 40);
  if (!eventId || !source) return null;
  const fbc = /^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{8,512}$/.test(input.fbc || '') ? input.fbc : '';
  const fbp = /^fb\.1\.\d{10,16}\.\d{1,20}$/.test(input.fbp || '') ? input.fbp : '';
  const url = /^https:\/\/(www\.)?sonnycourt\.com\/delta-vision\/?$/.test(String(input.url || '')) ? String(input.url) : PAGE_URL;
  return { eventId, source, medium: label(input.medium, 40), campaign: label(input.campaign, 100), content: label(input.content, 100), fbc, fbp, url };
}

/** Montant Spiffy (euros ou centimes) sinon prix connu du checkout, sinon 97. */
export function purchaseValue(rawAmount, checkoutId) {
  const number = Number(String(rawAmount ?? '').replace(',', '.'));
  if (Number.isFinite(number) && number > 0) return number > 1000 ? Math.round(number) / 100 : number;
  return DELTA_CHECKOUT_PRICES[String(checkoutId)] || 97;
}

export async function rememberMetaLead(email, attribution, { store = attributionStore(), now = () => Date.now() } = {}) {
  await store.setJSON(emailKey(email), { ...attribution, createdAt: new Date(now()).toISOString() });
}

/** Lit puis efface : l'attribution ne sert qu'une fois, pour le Purchase. */
export async function takeMetaLead(email, { store = attributionStore() } = {}) {
  const key = emailKey(email);
  const data = await store.get(key, { type: 'json' });
  if (!data || typeof data !== 'object') return null;
  try { await store.delete(key); } catch { /* Une suppression ratée sera reprise par la purge. */ }
  return data;
}

/** Lead CAPI (dédupliqué avec le pixel par eventId) puis mémorisation. Chaque étape échoue en silence. */
export async function recordMetaLead({ email, attribution, req, store, send = sendMetaEvent, now }) {
  const results = { lead: null, remembered: false };
  try {
    results.lead = await send({
      eventName: 'Lead', eventId: attribution.eventId, email,
      fbc: attribution.fbc || undefined, fbp: attribution.fbp || undefined,
      ip: req?.headers?.get?.('x-nf-client-connection-ip') || undefined,
      userAgent: req?.headers?.get?.('user-agent') || undefined,
      url: attribution.url, contentName: 'Delta Vision',
    });
  } catch (error) { console.warn('delta meta lead ignoré:', error?.message || error); }
  try {
    await rememberMetaLead(email, attribution, { store: store || attributionStore(), now });
    results.remembered = true;
  } catch (error) { console.warn('delta meta attribution non mémorisée:', error?.message || error); }
  return results;
}

/** Purchase CAPI seulement si l'email a été mémorisé comme lead Meta. */
export async function sendMetaPurchase({ email, orderId, checkoutId, rawAmount, store, send = sendMetaEvent }) {
  try {
    const lead = await takeMetaLead(email, { store: store || attributionStore() });
    if (!lead) return { ok: false, skipped: true, reason: 'not_meta_lead' };
    return await send({
      eventName: 'Purchase', eventId: 'dv-purchase-' + String(orderId || ''), email,
      fbc: lead.fbc || undefined, fbp: lead.fbp || undefined,
      url: lead.url || PAGE_URL, value: purchaseValue(rawAmount, checkoutId), currency: 'EUR', contentName: 'Delta Vision',
    });
  } catch (error) {
    console.warn('delta meta purchase ignoré:', error?.message || error);
    return { ok: false, error: String(error?.message || error) };
  }
}

/** Purge quotidienne des attributions jamais converties (30 jours). */
export async function pruneMetaAttribution(now = new Date(), store = attributionStore()) {
  const cutoff = now.getTime() - META_ATTRIBUTION_TTL_MS;
  const { blobs } = await store.list();
  let removed = 0;
  for (let i = 0; i < blobs.length; i += 20) {
    await Promise.all(blobs.slice(i, i + 20).map(async ({ key }) => {
      const data = await store.get(key, { type: 'json' }).catch(() => null);
      const at = Date.parse(data?.createdAt || '');
      if (!Number.isFinite(at) || at < cutoff) { await store.delete(key); removed++; }
    }));
  }
  return removed;
}
