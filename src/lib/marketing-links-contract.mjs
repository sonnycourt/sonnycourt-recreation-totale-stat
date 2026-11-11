import { bioLinkForCode } from './marketing-bio-links.mjs';

// Shared vocabulary. No credentials or customer data belong in a public link.
export const CHANNELS = Object.freeze({
  instagram: { label: 'Instagram', source: 'instagram', medium: 'organic_social' },
  facebook: { label: 'Facebook', source: 'facebook', medium: 'organic_social' },
  youtube: { label: 'YouTube', source: 'youtube', medium: 'organic_video' },
  tiktok: { label: 'TikTok', source: 'tiktok', medium: 'organic_social' },
  email: { label: 'Email · MailerLite', source: 'mailerlite', medium: 'email' },
  sms: { label: 'SMS', source: 'sms', medium: 'sms' },
  meta_ads: { label: 'Meta Ads', source: 'meta', medium: 'paid_social' },
});
export const FORMATS = Object.freeze({ short: 'Vidéo courte', long: 'Vidéo longue', email: 'Email', sms: 'SMS', post: 'Publication', bio: 'Lien de profil', other: 'Autre contenu' });
export const PLACEMENTS = Object.freeze({ dm: 'Message privé / ManyChat', description: 'Description', comment: 'Commentaire épinglé', bio: 'Bio / profil', button: 'Bouton', body: 'Corps du message', signature: 'Signature', story: 'Story', related_video: 'Vidéo associée' });
export const DESTINATIONS = Object.freeze({
  mc2: { label: 'Masterclass MC2', url: 'https://sonnycourt.com/mc2/' },
  meta_mc2: { label: 'Masterclass MC2 · parcours Meta', url: 'https://sonnycourt.com/meta/mc2/' },
  delta: { label: 'Delta Vision', url: 'https://sonnycourt.com/delta-vision/' },
  papa: { label: 'Guide · 10 questions à poser à ton père', url: 'https://sonnycourt.com/ressources/papa/' },
});
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CODE = /^[a-f0-9]{12}$/;
export function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/g, '');
}
function label(value, max, required = false) {
  const s = typeof value === 'string' ? value.trim() : '';
  if ((required && !s) || s.length > max || /[\u0000-\u001f]/.test(s)) throw new Error('Un champ est vide ou trop long.');
  return s;
}
export function publicationUrl(value) {
  const raw = label(value,2048);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Le lien de publication doit être une adresse complète en https://.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw new Error('Utilise un lien de publication public en https://.');
  return url.href;
}
export function publicationDate(value) {
  const date = label(value,10);
  if (!date) return null;
  const parsed = new Date(date+'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date || Number(date.slice(0,4))<1900) throw new Error('Vérifie la date de publication.');
  return date;
}
export function trackingCoverage(row) {
  const created=new Date(row.created_at || row.link_created_at);
  const valid=Number.isFinite(created.getTime());
  const createdDay=valid ? new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(created) : null;
  return { retrospective:Boolean(row.published_on && createdDay && row.published_on<createdDay), unknown:!row.published_on, since:valid ? created.toISOString() : null };
}
export function validatePublicationUpdate(input) {
  if (!UUID.test(input?.publication_id || '')) throw new Error('Publication invalide.');
  return { publication_id:input.publication_id, published_on:publicationDate(input.published_on), publication_url:publicationUrl(input.publication_url) };
}
export function validateCreate(input) {
  if (!input || !UUID.test(input.id || '') || !UUID.test(input.content_id || '')) throw new Error('Identifiant de création invalide.');
  if (!Object.hasOwn(CHANNELS,input.channel) || !Object.hasOwn(FORMATS,input.format) || !Object.hasOwn(PLACEMENTS,input.placement) || !Object.hasOwn(DESTINATIONS,input.destination)) throw new Error('Choisis un canal, un format, un emplacement et une destination valides.');
  const campaign = slug(input.campaign);
  if (!campaign) throw new Error('Donne un nom à cette campagne.');
  return {
    id: input.id, content_id: input.content_id, title: label(input.title, 160, true),
    format: input.format, topic: label(input.topic, 120), angle: label(input.angle, 240),
    channel: input.channel, placement: input.placement, campaign,
    destination: input.channel === 'meta_ads' && input.destination === 'mc2' ? 'meta_mc2' : input.destination,
    publication_label: label(input.publication_label, 160),
    published_on: publicationDate(input.published_on), publication_url: publicationUrl(input.publication_url),
  };
}
export function linkCode(id) { return id.replaceAll('-', '').slice(0, 12).toLowerCase(); }
export function buildDestination(link) {
  const dest = DESTINATIONS[link.destination], channel = CHANNELS[link.channel];
  if (!Object.hasOwn(DESTINATIONS,link.destination) || !Object.hasOwn(CHANNELS,link.channel) || !Object.hasOwn(PLACEMENTS,link.placement) || !CODE.test(link.code)) throw new Error('Lien invalide.');
  const url = new URL(dest.url);
  // Frozen IDs, not titles: renaming a content cannot fragment its attribution.
  url.searchParams.set('utm_source', channel.source);
  url.searchParams.set('utm_medium', channel.medium);
  url.searchParams.set('utm_campaign', link.campaign);
  url.searchParams.set('utm_content', link.code);
  url.searchParams.set('sc_link', link.code);
  return url.href;
}
export function shortUrl(code) { return `https://sonnycourt.com${bioLinkForCode(code)?.path || '/r/'+code}`; }
