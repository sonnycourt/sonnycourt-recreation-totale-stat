import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { detectMetaSource, rememberedMetaSource, fbcFrom, fbpFrom, initDeltaMetaPixel, DELTA_META_PIXEL_ID, META_SOURCE_KEY } from '../src/lib/delta-meta-pixel.mjs';
import { cleanMetaAttribution, purchaseValue, recordMetaLead, sendMetaPurchase, pruneMetaAttribution, emailKey } from '../netlify/functions/lib/delta-meta-attribution.mjs';
import register from '../netlify/functions/delta-vision-register.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

// --- Textes validés par Sonny le 24/10/2026 ---
const page = read('src/pages/delta-vision.astro');
assert(page.includes('Beaucoup ressentent un effet dès la première séance guidée.'));
assert(page.includes('Les ressentis varient d’une personne à l’autre. Démarche de bien-être, pas un traitement médical.'));
assert(page.includes('La respiration de Delta Vision est celle qui, dans ces études, augmente les ondes thêta et delta.'));
assert(page.includes("import { initDeltaMetaPixel } from '../lib/delta-meta-pixel.mjs'"));
for (const path of ['src/pages/delta-vision.astro', 'src/components/delta/UrgencyPreview.astro', 'src/components/delta/TwoStepCheckout.astro', 'src/lib/delta-vision-urgency.mjs', 'src/lib/delta-two-step-checkout.mjs']) {
  const source = read(path);
  assert(!/offre de lancement/i.test(source), path + ' mentionne encore l’offre de lancement');
  if (path.endsWith('.astro')) assert(source.includes('Ton tarif de bienvenue') || source.includes('ton tarif de bienvenue'));
}
assert(read('src/components/delta/UrgencyPreview.astro').includes('Ce tarif t’est réservé pendant 23 h à partir de ta première visite. Ensuite, Delta Vision est à 147 €.'));
assert(read('src/components/delta/TwoStepCheckout.astro').includes('Ce tarif t’est réservé pendant 23 h à partir de ta première visite. Ensuite, Delta Vision est à 147 €.'));
// Le pixel n'est jamais inséré en dur dans le HTML : seul le module le charge, pour le trafic Meta.
assert(!page.includes('connect.facebook.net') && !page.includes('fbq('));

// --- Détection du trafic Meta ---
assert.equal(detectMetaSource('?utm_source=newsletter'), null);
assert.equal(detectMetaSource(''), null);
assert.deepEqual(detectMetaSource('?utm_source=meta_ad&utm_medium=paid&utm_campaign=dv_reel_01&utm_content=reel-a'), { source: 'meta_ad', medium: 'paid', campaign: 'dv_reel_01', content: 'reel-a', fbclid: '' });
assert.equal(detectMetaSource('?fbclid=IwAR0abcDEF123').source, 'meta_ad');
assert.equal(detectMetaSource('?fbclid=IwAR0abcDEF123').fbclid, 'IwAR0abcDEF123');
assert.equal(detectMetaSource('?fbclid=<script>'), null, 'fbclid invalide = pas du trafic Meta');
assert.equal(detectMetaSource('?utm_source=Instagram').source, 'instagram');
assert.equal(detectMetaSource('?utm_campaign=<b>x</b>&utm_source=fb').campaign, '');

// --- Mémoire 7 jours ---
const memory = new Map(), storage = { getItem: k => memory.has(k) ? memory.get(k) : null, setItem: (k, v) => memory.set(k, v) };
const t0 = 1_800_000_000_000;
assert.equal(rememberedMetaSource(storage, t0, null), null);
const fresh = detectMetaSource('?fbclid=IwAR0abcDEF123&utm_source=meta_ad&utm_campaign=dv');
assert.deepEqual(rememberedMetaSource(storage, t0, fresh), fresh);
assert.equal(JSON.parse(memory.get(META_SOURCE_KEY)).at, t0);
assert.deepEqual(rememberedMetaSource(storage, t0 + 6 * 86400000, null), fresh);
assert.equal(rememberedMetaSource(storage, t0 + 8 * 86400000, null), null, 'la mémoire expire après 7 jours');
assert.equal(rememberedMetaSource(storage, t0 - 1000, null), null, 'une date future est rejetée');
memory.set(META_SOURCE_KEY, '{broken');
assert.equal(rememberedMetaSource(storage, t0, null), null);
const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
assert.deepEqual(rememberedMetaSource(broken, t0, fresh), fresh, 'sans stockage, la visite Meta courante reste mesurée');

// --- Cookies Meta ---
assert.equal(fbcFrom('_fbp=fb.1.1700000000000.123; _fbc=fb.1.1700000000000.IwAR0zzz', 'other', t0), 'fb.1.1700000000000.IwAR0zzz');
assert.equal(fbcFrom('', 'IwAR0abcDEF123', t0), `fb.1.${t0}.IwAR0abcDEF123`);
assert.equal(fbcFrom('', '', t0), '');
assert.equal(fbpFrom('_fbp=fb.1.1700000000000.123456'), 'fb.1.1700000000000.123456');
assert.equal(fbpFrom('_fbp=evil'), '');

// --- Pixel navigateur : chargé seulement pour Meta, événements attendus ---
function fakeBrowser(search, cookie = '') {
  const calls = [], listeners = {}, head = { appended: [] };
  const doc = {
    cookie, documentElement: { dataset: {} }, head: { appendChild: s => head.appended.push(s) },
    querySelector: () => null, createElement: () => ({ dataset: {} }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    dispatch: (type, detail) => listeners[type]?.({ detail }),
  };
  const win = {
    location: { search, origin: 'https://sonnycourt.com', pathname: '/delta-vision/' },
    addEventListener() {}, setTimeout(fn) { fn(); }, localStorage: { getItem: () => null, setItem() {} },
  };
  const api = initDeltaMetaPixel(doc, win, { now: () => t0 });
  if (win.fbq) { win.fbq.callMethod = (...args) => calls.push(args); win.fbq.queue.forEach(args => calls.push([...args])); }
  return { api, calls, doc, win, head };
}
assert.equal(fakeBrowser('?utm_source=youtube').api, null);
assert.equal(fakeBrowser('').win.fbq, undefined, 'aucun fbq pour l’organique');
const meta = fakeBrowser('?fbclid=IwAR0abcDEF123&utm_source=meta_ad&utm_campaign=dv_reel_01', '_fbp=fb.1.1700000000000.42');
assert.equal(meta.head.appended.length, 1, 'le script Meta est chargé pour le trafic Meta');
assert.deepEqual(meta.calls.map(c => c[1] || c[0]), [DELTA_META_PIXEL_ID, 'PageView', 'ViewContent']);
assert.deepEqual(meta.calls[2][2], { content_name: 'Delta Vision', content_type: 'product', currency: 'EUR', value: 97 });
meta.doc.dispatch('dv:checkout-open', { price: 97 });
meta.doc.dispatch('dv:lead', { eventId: '12345678-1234-4123-8123-123456789012', price: 97 });
meta.doc.dispatch('dv:lead', {});
assert.equal(meta.calls[3][1], 'InitiateCheckout');
assert.equal(meta.calls[4][1], 'Lead');
assert.deepEqual(meta.calls[4][3], { eventID: '12345678-1234-4123-8123-123456789012' });
assert.equal(meta.calls.length, 5, 'un Lead sans eventId n’est pas envoyé');
assert.deepEqual(meta.api.attribution(), { source: 'meta_ad', medium: '', campaign: 'dv_reel_01', content: '', fbc: `fb.1.${t0}.IwAR0abcDEF123`, fbp: 'fb.1.1700000000000.42', url: 'https://sonnycourt.com/delta-vision/' });

// --- Validation serveur ---
const eventId = '12345678-1234-4123-8123-123456789012';
assert.equal(cleanMetaAttribution(null), null);
assert.equal(cleanMetaAttribution({ source: 'meta_ad' }), null, 'eventId obligatoire');
assert.equal(cleanMetaAttribution({ eventId, source: '' }), null);
assert.deepEqual(cleanMetaAttribution({ eventId: eventId.toUpperCase(), source: 'meta_ad', campaign: 'dv_reel_01', fbc: 'fb.1.1700000000000.IwAR0abc', fbp: 'junk', url: 'https://evil.test/' }),
  { eventId, source: 'meta_ad', medium: '', campaign: 'dv_reel_01', content: '', fbc: 'fb.1.1700000000000.IwAR0abc', fbp: '', url: 'https://sonnycourt.com/delta-vision/' });
assert.equal(purchaseValue('97.00', '41049'), 97);
assert.equal(purchaseValue(9700, '41049'), 97, 'centimes Spiffy convertis');
assert.equal(purchaseValue(undefined, '41096'), 147);
assert.equal(purchaseValue('abc', '00000'), 97);

// --- Lead + Purchase CAPI avec stockage et envoi simulés ---
function fakeStore() {
  const data = new Map();
  return { data, setJSON: async (k, v) => data.set(k, v), get: async k => data.get(k) ?? null, delete: async k => data.delete(k), list: async () => ({ blobs: [...data.keys()].map(key => ({ key })) }) };
}
const store = fakeStore(), sent = [];
const send = async payload => { sent.push(payload); return { ok: true }; };
const attribution = cleanMetaAttribution({ eventId, source: 'meta_ad', campaign: 'dv_reel_01', fbc: 'fb.1.1700000000000.IwAR0abc', fbp: 'fb.1.1700000000000.42' });
const req = new Request('https://sonnycourt.com/x', { headers: { 'x-nf-client-connection-ip': '203.0.113.9', 'user-agent': 'QA' } });
const recorded = await recordMetaLead({ email: 'QA@Example.com', attribution, req, store, send, now: () => t0 });
assert.equal(recorded.remembered, true);
assert.equal(sent[0].eventName, 'Lead'); assert.equal(sent[0].eventId, eventId); assert.equal(sent[0].ip, '203.0.113.9'); assert.equal(sent[0].fbc, 'fb.1.1700000000000.IwAR0abc');
assert.equal(store.data.get(emailKey('qa@example.com')).createdAt, new Date(t0).toISOString(), 'clé = SHA-256 de l’email normalisé');
assert.equal(emailKey(' QA@Example.com '), createHash('sha256').update('qa@example.com').digest('hex'));
const organic = await sendMetaPurchase({ email: 'nobody@example.com', orderId: '1', checkoutId: '41049', store, send });
assert.equal(organic.skipped, true); assert.equal(sent.length, 1, 'un acheteur organique n’envoie rien à Meta');
const purchase = await sendMetaPurchase({ email: 'qa@example.com', orderId: '555', checkoutId: '41049', rawAmount: '97', store, send });
assert.equal(purchase.ok, true);
assert.equal(sent[1].eventName, 'Purchase'); assert.equal(sent[1].eventId, 'dv-purchase-555'); assert.equal(sent[1].value, 97); assert.equal(sent[1].currency, 'EUR'); assert.equal(sent[1].fbp, 'fb.1.1700000000000.42');
assert.equal(store.data.size, 0, 'l’attribution est effacée après usage');
const again = await sendMetaPurchase({ email: 'qa@example.com', orderId: '555', checkoutId: '41049', store, send });
assert.equal(again.skipped, true, 'pas de double Purchase');
const failing = { ...fakeStore(), get: async () => { throw Error('blobs down'); } };
assert.equal((await sendMetaPurchase({ email: 'qa@example.com', orderId: '1', checkoutId: '41049', store: failing, send })).ok, false, 'une panne Blobs ne jette jamais');
const broke = await recordMetaLead({ email: 'qa@example.com', attribution, req, store: { setJSON: async () => { throw Error('blobs down'); } }, send: async () => { throw Error('meta down'); } });
assert.deepEqual(broke, { lead: null, remembered: false });

// --- Purge 30 jours ---
const old = fakeStore();
await old.setJSON('a', { createdAt: new Date(t0 - 31 * 86400000).toISOString() });
await old.setJSON('b', { createdAt: new Date(t0 - 2 * 86400000).toISOString() });
await old.setJSON('c', { nope: true });
assert.equal(await pruneMetaAttribution(new Date(t0), old), 2);
assert.deepEqual([...old.data.keys()], ['b']);

// --- Fonction register : l'attribution Meta n'altère ni la réponse ni MailerLite ---
const originalFetch = global.fetch;
Object.assign(process.env, { MAILERLITE_API_KEY: 'mock', MAILERLITE_GROUP_DELTA_VISION_REGISTRATIONS: '111', META_PIXEL_ID: '3367958190030822', META_ACCESS_TOKEN: 'mock', META_CAPI_ALLOW_NON_PRODUCTION: 'true' });
const calls = [];
global.fetch = async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body) }); return new Response(String(url).includes('mailerlite') ? '{"data":{"id":"mock"}}' : '{"events_received":1}'); };
try {
  const post = body => register(new Request('https://sonnycourt.com/.netlify/functions/delta-vision-register', { method: 'POST', headers: { Origin: 'https://sonnycourt.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  let response = await post({ firstName: 'QA', email: 'qa@example.com' });
  assert.equal(response.status, 200); assert.equal(calls.length, 1, 'organique : MailerLite seulement');
  response = await post({ firstName: 'QA', email: 'qa@example.com', meta: { eventId, source: 'meta_ad', fbc: 'fb.1.1700000000000.IwAR0abc' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  const graph = calls.filter(c => c.url.includes('graph.facebook.com'));
  assert.equal(graph.length, 1, 'trafic Meta : un Lead CAPI');
  assert.equal(graph[0].body.data[0].event_name, 'Lead'); assert.equal(graph[0].body.data[0].event_id, eventId);
  assert.equal(graph[0].body.data[0].user_data.em[0], createHash('sha256').update('qa@example.com').digest('hex'));
  assert.equal(graph[0].body.data[0].user_data.fbc, 'fb.1.1700000000000.IwAR0abc');
  response = await post({ firstName: 'QA', email: 'qa@example.com', meta: { source: 'meta_ad' } });
  assert.equal(response.status, 200); assert.equal(calls.filter(c => c.url.includes('graph.facebook.com')).length, 1, 'attribution invalide ignorée sans erreur');
} finally { global.fetch = originalFetch; }

console.log('PASS: textes validés, pixel réservé au trafic Meta, Lead dédupliqué, Purchase serveur pour les seuls leads Meta, purge 30 jours, register inchangé pour l’organique.');
