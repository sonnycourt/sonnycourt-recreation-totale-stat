// Paiement hébergé chez Spiffy pour conserver les wallets natifs.
// VSL Delta Vision : le lecteur Bunny est chargé au clic sur le thumbnail.
export const inspira = Object.freeze({
  presentationVideoUrl: 'https://player.mediadelivery.net/play/779556/34065191-3614-4d7b-b005-27f8e83d43a0',
  presentationPosterUrl: '/media/pages/inspira-vsl-jungle-v2.webp',
  price: 97,
  standardPrice: 147,
  standardCheckoutUrl: 'https://sonnycourt.spiffy.co/checkout/delta-vision-standard?locale=fr',
  checkoutUrl: 'https://sonnycourt.spiffy.co/checkout/delta-vision-1?locale=fr',
  referencePrice: 147,
  title: 'Delta Vision — Respire. Visualise. Intègre.',
  description: 'Une expérience guidée qui réunit le souffle et la visualisation. Fais de la place au calme, à la clarté et à un nouvel élan.',
});

export function inspiraEmbedUrl(raw = '') {
  if (!raw.trim()) return '';
  const url = new URL(raw);
  const match = url.pathname.match(/^\/(?:play|embed)\/(\d+)\/([a-f0-9-]{36})\/?$/i);
  if (url.protocol !== 'https:' || url.hostname !== 'player.mediadelivery.net' || !match) {
    throw new Error('La VSL Delta Vision doit utiliser une URL Bunny Stream HTTPS.');
  }
  return `https://player.mediadelivery.net/embed/${match[1]}/${match[2]}?autoplay=false&preload=true&responsive=true&rememberPosition=false&rememberSettings=false&t=0`;
}
