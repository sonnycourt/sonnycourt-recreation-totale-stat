import { resolveActiveVideoConfig } from './lib/webinaire-video-config.mjs';
import { getPlaybackCommand } from './lib/webinaire-live-playback-command.mjs';
import { getUiTimingConfig } from './lib/webinaire-ui-timing.mjs';

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

  try {
    const cfg = await resolveActiveVideoConfig();
    const [playbackCommand, uiTiming] = await Promise.all([
      getPlaybackCommand(),
      getUiTimingConfig(),
    ]);
    return jsonResponse(200, {
      ok: true,
      activeSource: cfg.activeSource,
      activeUrl: cfg.activeUrl,
      hasBackup: Boolean(cfg.sources.backup),
      playbackCommand,
      uiTiming,
    });
  } catch (error) {
    console.error('webinaire-video-config error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

