// Places affichées : remainingSeats au départ, puis 0 à endsAt.
// Paliers de durée égale. La dernière place reste jusqu'à l'échéance exacte.
// Même horaire pour tout le monde.
export function scheduledRemainingSeats(config, now = Date.now()) {
  const remaining = config.remainingSeats;
  if (remaining === null) return null;
  if (!Number.isInteger(remaining) || remaining < 0) return null;
  if (remaining === 0) return 0;
  const start = Date.parse(config.startsAt);
  const end = Date.parse(config.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < end) || !Number.isFinite(now)) return remaining;
  if (now <= start) return remaining;
  if (now >= end) return 0;
  const consumed = Math.min(remaining - 1, Math.floor((now - start) * remaining / (end - start)));
  return remaining - consumed;
}

export function campaignState(config, now = Date.now()) {
  const start = Date.parse(config.startsAt);
  const end = Date.parse(config.endsAt);
  const capacity = config.capacity;
  const configured = config.remainingSeats;
  const valid = Number.isFinite(start) && Number.isFinite(end) && start < end
    && Number.isFinite(now) && Number.isInteger(capacity) && capacity > 0
    && (configured === null || (Number.isInteger(configured) && configured >= 0 && configured <= capacity));
  const remaining = valid ? scheduledRemainingSeats(config, now) : null;
  if (!valid) return { phase: 'invalid', seconds: 0, available: false, remaining: null };
  if (!config.published) return { phase: 'draft', seconds: 0, available: false, remaining };
  if (now < start) return { phase: 'upcoming', seconds: Math.ceil((start - now) / 1000), available: false, remaining };
  if (now >= end) return { phase: 'expired', seconds: 0, available: false, remaining: configured === null ? null : 0 };
  if (remaining === 0) return { phase: 'full', seconds: Math.ceil((end - now) / 1000), available: false, remaining: 0 };
  return { phase: 'active', seconds: Math.ceil((end - now) / 1000), available: true, remaining };
}

export function bunnyEmbedUrl(config) {
  if (!/^\d+$/.test(config.videoLibraryId) || !/^[0-9a-f-]{36}$/i.test(config.videoId)) {
    throw new Error('Identifiant de vidéo Bunny invalide.');
  }
  const url = new URL(`https://player.mediadelivery.net/embed/${config.videoLibraryId}/${config.videoId}`);
  url.search = new URLSearchParams({ autoplay: 'false', loop: 'false', muted: 'false', preload: 'false', responsive: 'true' }).toString();
  return url.toString();
}

export function clockParts(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(value / 86400), Math.floor(value / 3600) % 24, Math.floor(value / 60) % 60, value % 60]
    .map(number => String(number).padStart(2, '0'));
}
