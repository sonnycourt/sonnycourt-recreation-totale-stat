// Pixel Meta de la page Delta Vision.
// Chargé uniquement pour le trafic venu d'une pub Meta (fbclid ou utm_source Meta),
// mémorisé 7 jours dans ce navigateur pour couvrir le retour et l'achat.
// L'organique ne charge rien : la page garde son modèle de mesure consentie.
export const DELTA_META_PIXEL_ID = '3367958190030822';
export const META_SOURCE_KEY = 'dv_meta_source_v1';
export const META_SOURCE_TTL_MS = 7 * 86400000;
const META_SOURCES = new Set(['meta', 'meta_ad', 'meta_ads', 'facebook', 'fb', 'fb_ad', 'instagram', 'ig', 'ig_ad']);
const label = (value, max = 100) => typeof value === 'string' && /^[\p{L}\p{N} ._:/-]*$/u.test(value) ? value.slice(0, max) : '';
const FBCLID = /^[A-Za-z0-9_-]{8,512}$/;

/** Lit l'URL d'arrivée : null si elle ne vient pas d'une pub Meta. */
export function detectMetaSource(search) {
  const params = new URLSearchParams(search || '');
  const fbclid = FBCLID.test(params.get('fbclid') || '') ? params.get('fbclid') : '';
  const source = label((params.get('utm_source') || '').trim().toLowerCase(), 40);
  if (!fbclid && !META_SOURCES.has(source)) return null;
  return {
    source: source || 'meta_ad',
    medium: label(params.get('utm_medium') || '', 40),
    campaign: label(params.get('utm_campaign') || '', 100),
    content: label(params.get('utm_content') || '', 100),
    fbclid,
  };
}

/** Une arrivée Meta fraîche remplace la précédente ; sinon on relit la mémoire si elle a moins de 7 jours. */
export function rememberedMetaSource(storage, now, fresh) {
  const safely = fn => { try { return fn(); } catch { return null; } };
  if (fresh) {
    safely(() => storage.setItem(META_SOURCE_KEY, JSON.stringify({ ...fresh, at: now })));
    return fresh;
  }
  const saved = safely(() => JSON.parse(storage.getItem(META_SOURCE_KEY)));
  if (!saved || typeof saved !== 'object' || !Number.isFinite(saved.at) || now - saved.at > META_SOURCE_TTL_MS || now < saved.at) return null;
  const source = label(String(saved.source || ''), 40);
  if (!source) return null;
  return { source, medium: label(saved.medium, 40), campaign: label(saved.campaign, 100), content: label(saved.content, 100), fbclid: FBCLID.test(saved.fbclid || '') ? saved.fbclid : '' };
}

export function readCookie(cookie, name) {
  const found = String(cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}

/** _fbc posé par le pixel ; sinon reconstruit depuis le fbclid au format officiel fb.1.<ms>.<fbclid>. */
export function fbcFrom(cookie, fbclid, now) {
  const existing = readCookie(cookie, '_fbc');
  if (/^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{8,512}$/.test(existing)) return existing;
  return fbclid ? `fb.1.${now}.${fbclid}` : '';
}

export function fbpFrom(cookie) {
  const existing = readCookie(cookie, '_fbp');
  return /^fb\.1\.\d{10,16}\.\d{1,20}$/.test(existing) ? existing : '';
}

function installFbq(win, doc) {
  if (win.fbq) return win.fbq;
  const n = win.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!win._fbq) win._fbq = n;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  const load = () => {
    if (doc.querySelector('script[data-sonny-meta-pixel]')) return;
    const script = doc.createElement('script');
    script.async = true; script.dataset.sonnyMetaPixel = 'true';
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    doc.head.appendChild(script);
  };
  // Les événements sont mis en file tout de suite ; le fichier tiers attend le contenu critique.
  win.addEventListener('pointerdown', load, { once: true, passive: true });
  win.addEventListener('keydown', load, { once: true });
  if ('requestIdleCallback' in win) win.requestIdleCallback(load, { timeout: 1500 }); else win.setTimeout(load, 800);
  return n;
}

/**
 * Initialise le pixel si la visite vient d'une pub Meta. Retourne null sinon.
 * Événements : PageView, ViewContent au chargement ; InitiateCheckout à l'ouverture du popup ;
 * Lead à l'étape email (eventID partagé avec la CAPI). Le Purchase est envoyé côté serveur uniquement.
 */
export function initDeltaMetaPixel(doc, win, { now = () => Date.now(), storage = win.localStorage } = {}) {
  const context = rememberedMetaSource(storage, now(), detectMetaSource(win.location.search));
  if (!context) return null;
  const fbq = installFbq(win, doc);
  const price = () => doc.documentElement.dataset.dvOffer === 'standard' ? 147 : 97;
  const content = extra => ({ content_name: 'Delta Vision', content_type: 'product', currency: 'EUR', ...extra });
  fbq('init', DELTA_META_PIXEL_ID);
  fbq('track', 'PageView');
  fbq('track', 'ViewContent', content({ value: price() }));
  doc.addEventListener('dv:checkout-open', event => fbq('track', 'InitiateCheckout', content({ value: Number(event.detail?.price) || price() })));
  doc.addEventListener('dv:lead', event => {
    const eventId = event.detail?.eventId;
    if (!eventId) return;
    fbq('track', 'Lead', content({ value: Number(event.detail?.price) || price() }), { eventID: eventId });
  });
  const attribution = () => ({
    source: context.source,
    medium: context.medium,
    campaign: context.campaign,
    content: context.content,
    fbc: fbcFrom(doc.cookie, context.fbclid, now()),
    fbp: fbpFrom(doc.cookie),
    url: win.location.origin + win.location.pathname,
  });
  return { context, attribution };
}
