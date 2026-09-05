export const MC2_LIVE_VIDEO_LEAD_SECONDS = 15 * 60;
export const MC2_LIVE_VIDEO_LEAD_MS = MC2_LIVE_VIDEO_LEAD_SECONDS * 1000;

// Durée réelle arrondie au supérieur de la vidéo live Bunny actuellement diffusée.
export const MC2_LIVE_VIDEO_DURATION_SECONDS = 8_041;
export const MC2_LIVE_VIDEO_DURATION_MS = MC2_LIVE_VIDEO_DURATION_SECONDS * 1000;

// session_starts_at correspond à l'heure annoncée, alors que la vidéo démarre
// quinze minutes plus tôt. La fin canonique est donc à +1 h 59 min 01 s.
export const MC2_SESSION_DURATION_SECONDS = MC2_LIVE_VIDEO_DURATION_SECONDS
  - MC2_LIVE_VIDEO_LEAD_SECONDS;
export const MC2_SESSION_DURATION_MS = MC2_SESSION_DURATION_SECONDS * 1000;

export const MC2_LIVE_CTA_SECONDS = (94 * 60) + 51;
export const MC2_REPLAY_COUNTDOWN_REMOVED_SECONDS = 20 * 60;
export const MC2_REPLAY_CTA_SECONDS = MC2_LIVE_CTA_SECONDS
  - MC2_REPLAY_COUNTDOWN_REMOVED_SECONDS;

// Le replay reste accessible 72 heures après l'heure annoncée de la session.
// L'offre live garde cette même échéance. Pour une offre découverte en replay,
// on retire la durée de vidéo déjà consommée avant le CTA afin que le compteur
// ne s'ouvre jamais artificiellement sur « 3 jours pile ».
export const MC2_OFFER_DURATION_MS = 72 * 60 * 60 * 1000;
export const MC2_REPLAY_OFFER_DURATION_MS = Math.max(
  0,
  MC2_OFFER_DURATION_MS - MC2_REPLAY_CTA_SECONDS * 1000,
);

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

export function mc2SessionEndsAt(sessionStartsAt) {
  const start = validDate(sessionStartsAt);
  return start ? new Date(start.getTime() + MC2_SESSION_DURATION_MS) : null;
}

export function mc2SessionEndsAtIso(sessionStartsAt) {
  return mc2SessionEndsAt(sessionStartsAt)?.toISOString() || null;
}

export function mc2OfferExpiresAt(sessionStartsAt) {
  const start = validDate(sessionStartsAt);
  return start ? new Date(start.getTime() + MC2_OFFER_DURATION_MS) : null;
}

export function mc2ReplayExpiresAt(sessionStartsAt) {
  return mc2OfferExpiresAt(sessionStartsAt);
}

export function mc2ReplayOfferExpiresAt(ctaReachedAt) {
  const reachedAt = validDate(ctaReachedAt);
  return reachedAt ? new Date(reachedAt.getTime() + MC2_REPLAY_OFFER_DURATION_MS) : null;
}
