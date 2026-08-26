export const MC2_LIVE_VIDEO_LEAD_SECONDS = 15 * 60;
export const MC2_LIVE_VIDEO_LEAD_MS = MC2_LIVE_VIDEO_LEAD_SECONDS * 1000;

// Durée réelle arrondie au supérieur de la vidéo live Bunny actuellement diffusée.
export const MC2_LIVE_VIDEO_DURATION_SECONDS = 7_103;
export const MC2_LIVE_VIDEO_DURATION_MS = MC2_LIVE_VIDEO_DURATION_SECONDS * 1000;

// session_starts_at correspond à l'heure annoncée, alors que la vidéo démarre
// quinze minutes plus tôt. La fin canonique est donc à +1 h 43 min 23 s.
export const MC2_SESSION_DURATION_SECONDS = MC2_LIVE_VIDEO_DURATION_SECONDS
  - MC2_LIVE_VIDEO_LEAD_SECONDS;
export const MC2_SESSION_DURATION_MS = MC2_SESSION_DURATION_SECONDS * 1000;

export const MC2_LIVE_CTA_SECONDS = 97 * 60 + 28;
export const MC2_REPLAY_COUNTDOWN_REMOVED_SECONDS = 20 * 60;
export const MC2_REPLAY_CTA_SECONDS = MC2_LIVE_CTA_SECONDS
  - MC2_REPLAY_COUNTDOWN_REMOVED_SECONDS;

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
