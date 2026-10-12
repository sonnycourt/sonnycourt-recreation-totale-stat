// Page de présentation en préparation. Aucun checkout ni collecte de données.
// Remplacer par l'URL Bunny de la VSL Delta Vision quand elle sera prête.
export const inspira = Object.freeze({
  presentationVideoUrl: '',
  presentationPosterUrl: '/media/pages/inspira-vsl-jungle-v2.webp',
  price: 27,
  referencePrice: 97,
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
  return `https://player.mediadelivery.net/embed/${match[1]}/${match[2]}?autoplay=true&preload=true&responsive=true`;
}

