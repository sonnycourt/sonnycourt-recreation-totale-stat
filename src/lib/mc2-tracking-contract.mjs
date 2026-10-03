import { MC2_LIVE_CTA_SECONDS, MC2_REPLAY_CTA_SECONDS, MC2_LIVE_VIDEO_DURATION_SECONDS, MC2_REPLAY_VIDEO_DURATION_SECONDS } from './mc2-timing.mjs';
import { MC2_DRAFTX_LIVE_VIDEO_ID, MC2_DRAFTX_REPLAY_VIDEO_ID } from './mc2-draftx-media.mjs';

export const TRACKING_SCHEMA = 2;
export const TRACKING_BUILD = 'mc2-tracking-2.0.0';
export const OFFER_VERSION = 'es2-197x12-1297-2026-09';
export const TRACKING_EVENTS = new Set([
  'journey_started', 'playback_started', 'playback_interval', 'player_state',
  'cta_playback_present', 'offer_playback_present', 'offer_available', 'offer_visible',
  'offer_scroll_started', 'offer_depth', 'offer_section_visible',
  'checkout_opened', 'checkout_step_viewed', 'checkout_step_completed',
  'checkout_plan_selected', 'checkout_closed', 'payment_frame_loading',
  'payment_frame_visible', 'payment_frame_timeout', 'payment_frame_retry',
  'payment_redirect_observed', 'tracking_diagnostic',
]);
export function trackingMedia(route) {
  return route === '/mc2/replay/'
    ? { mode: 'replay', version: 'w14-replay', id: MC2_DRAFTX_REPLAY_VIDEO_ID, cta: MC2_REPLAY_CTA_SECONDS, duration: MC2_REPLAY_VIDEO_DURATION_SECONDS }
    : { mode: 'live', version: 'w14-live', id: MC2_DRAFTX_LIVE_VIDEO_ID, cta: MC2_LIVE_CTA_SECONDS, duration: MC2_LIVE_VIDEO_DURATION_SECONDS };
}
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function trackingId(view = globalThis) {
  if (view.crypto?.randomUUID) return view.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

// Explicit allowlist: never copy identity, arbitrary URLs, card fields or tokens into metadata.
export function sanitizeTrackingMeta(input = {}) {
  const output = {};
  if (Number.isSafeInteger(input.session_generation) && input.session_generation >= 0) output.session_generation = input.session_generation;
  for (const key of ['tracker_build', 'button_id', 'section', 'plan', 'payment_mode', 'checkout_attempt_id', 'frame_evidence', 'state', 'reason', 'frame_status']) {
    if (typeof input[key] === 'string') output[key] = input[key].slice(0, 100);
  }
  for (const key of ['position_start', 'position_end', 'current_second', 'elapsed_seconds', 'playback_rate', 'depth_percent', 'step', 'dropped_events', 'rejected_events', 'observer_errors', 'queue_length']) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key]) && input[key] >= 0) output[key] = Math.min(86400, Math.round(input[key] * 1000) / 1000);
  }
  for (const key of ['foreground', 'paused', 'seeking', 'fullscreen', 'picture_in_picture', 'is_playing', 'frames_supported', 'frames_advanced']) {
    if (typeof input[key] === 'boolean') output[key] = input[key];
  }
  for (const key of ['interval_started_at', 'interval_ended_at']) {
    if (typeof input[key] === 'string' && Number.isFinite(Date.parse(input[key]))) output[key] = new Date(input[key]).toISOString();
  }
  return output;
}
