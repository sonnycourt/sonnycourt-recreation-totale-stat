// Driven exclusively by the player's media position, never wall-clock time.
export function secondsUntilDvpOffer(seconds, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.max(0, Math.ceil(duration - 60 - seconds));
}
export function formatDvpCountdown(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`;
}
