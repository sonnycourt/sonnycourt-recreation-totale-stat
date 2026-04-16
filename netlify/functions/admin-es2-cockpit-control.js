import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import {
  resolveActiveVideoConfig,
  setActiveVideoSource,
  clearActiveVideoSourceOverride,
} from './lib/webinaire-video-config.mjs';

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

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json();
    const action = String(body?.action || '').trim();

    if (action === 'switch_primary') {
      await setActiveVideoSource('primary');
    } else if (action === 'switch_backup') {
      await setActiveVideoSource('backup');
    } else if (action === 'clear_override') {
      await clearActiveVideoSourceOverride();
    } else {
      return jsonResponse(400, { error: 'Action invalide' });
    }

    const cfg = await resolveActiveVideoConfig();
    return jsonResponse(200, {
      ok: true,
      activeSource: cfg.activeSource,
      activeUrl: cfg.activeUrl,
      hasBackup: Boolean(cfg.sources.backup),
    });
  } catch (error) {
    console.error('admin-es2-cockpit-control error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

