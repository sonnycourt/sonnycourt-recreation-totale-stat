import { getMc2ForceRefreshAt, resolveMc2VideoConfig } from './lib/mc2-video-config.mjs';
import { MC2_DRAFTX_LIVE_HLS_URL } from '../../src/lib/mc2-draftx-media.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });
  const variant = new URL(req.url).searchParams.get('variant');
  // Keep the unversioned endpoint unchanged for W12 players already open.
  // New canonical pages explicitly request W13B; never force a reload here.
  if (variant === 'draftx' || variant === 'w13b') {
    return jsonResponse(200, {
      ok: true, variant, activeSource: 'primary',
      activeUrl: MC2_DRAFTX_LIVE_HLS_URL, hasBackup: false,
      playbackCommand: null, forceRefreshAt: null,
    });
  }

  try {
    const cfg = await resolveMc2VideoConfig();
    const forceRefreshAt = await getMc2ForceRefreshAt();
    return jsonResponse(200, {
      ok: true,
      activeSource: cfg.activeSource,
      activeUrl: cfg.activeUrl,
      hasBackup: Boolean(cfg.sources.backup),
      playbackCommand: null,
      forceRefreshAt,
    });
  } catch (error) {
    console.error('mc2-video-config error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
