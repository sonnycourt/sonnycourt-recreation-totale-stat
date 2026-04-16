import { getStore } from '@netlify/blobs';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';
import { resolveActiveVideoConfig } from './lib/webinaire-video-config.mjs';

const PRESENCE_STORE = 'webinaire-live-presence';
const PRESENCE_PREFIX = 'presence:';
const PRESENCE_ACTIVE_MS = 45 * 1000;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function formatParisIso(now = new Date()) {
  return now.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).replace(' ', 'T');
}

async function headCheck(url) {
  if (!url) return { ok: false, status: null, error: 'URL absente' };
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return { ok: res.ok, status: res.status, error: null };
  } catch (error) {
    return { ok: false, status: null, error: error?.message || 'network error' };
  }
}

function pickCurrentSession(rows, nowMs) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const parsed = rows
    .map((r) => ({
      session_date: r.session_date,
      offre_expires_at: r.offre_expires_at,
      sessionMs: new Date(r.session_date).getTime(),
      offerMs: new Date(r.offre_expires_at).getTime(),
      statut: r.statut || '',
    }))
    .filter((r) => Number.isFinite(r.sessionMs) && Number.isFinite(r.offerMs));

  if (!parsed.length) return null;

  const live = parsed.find((r) => nowMs >= r.sessionMs - 15 * 60 * 1000 && nowMs < r.offerMs);
  if (live) return { sessionMs: live.sessionMs, offerMs: live.offerMs };

  const upcoming = parsed
    .filter((r) => r.sessionMs >= nowMs - 15 * 60 * 1000)
    .sort((a, b) => a.sessionMs - b.sessionMs)[0];
  if (upcoming) return { sessionMs: upcoming.sessionMs, offerMs: upcoming.offerMs };

  return parsed.sort((a, b) => b.sessionMs - a.sessionMs)[0];
}

async function getPresenceCounts() {
  try {
    const store = getStore(PRESENCE_STORE);
    const listed = await store.list({ prefix: PRESENCE_PREFIX });
    const blobs = listed?.blobs || [];
    let waiting = 0;
    let session = 0;
    let replay = 0;
    let activeTotal = 0;
    const now = Date.now();

    for (const item of blobs) {
      const raw = await store.get(item.key);
      if (!raw) continue;
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const ts = Number(data?.ts || 0);
      if (!Number.isFinite(ts) || now - ts > PRESENCE_ACTIVE_MS) continue;
      activeTotal += 1;
      if (data.stage === 'waiting') waiting += 1;
      else if (data.stage === 'replay') replay += 1;
      else session += 1;
    }

    return { activeTotal, waiting, session, replay };
  } catch (error) {
    return {
      activeTotal: 0,
      waiting: 0,
      session: 0,
      replay: 0,
      error: error?.message || 'presence unavailable',
    };
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const now = new Date();
    const nowMs = now.getTime();
    const registrations = await supabaseGet(
      'webinaire_registrations?select=session_date,offre_expires_at,statut&order=session_date.desc&limit=1000',
    );
    const rows = Array.isArray(registrations.data) ? registrations.data : [];
    const currentSession = pickCurrentSession(rows, nowMs);

    let sessionPopulation = {
      total: 0,
      inscrit: 0,
      present: 0,
      acheteur: 0,
      non_acheteur: 0,
      no_show: 0,
    };
    if (currentSession) {
      for (const r of rows) {
        const ms = new Date(r.session_date).getTime();
        if (ms !== currentSession.sessionMs) continue;
        sessionPopulation.total += 1;
        if (r.statut === 'inscrit') sessionPopulation.inscrit += 1;
        else if (r.statut === 'present') sessionPopulation.present += 1;
        else if (r.statut === 'acheteur') sessionPopulation.acheteur += 1;
        else if (r.statut === 'non-acheteur') sessionPopulation.non_acheteur += 1;
        else if (r.statut === 'no-show') sessionPopulation.no_show += 1;
      }
    }

    const cfg = await resolveActiveVideoConfig();
    const [primaryCheck, backupCheck, activeCheck, presence] = await Promise.all([
      headCheck(cfg.sources.primary),
      headCheck(cfg.sources.backup),
      headCheck(cfg.activeUrl),
      getPresenceCounts(),
    ]);

    return jsonResponse(200, {
      ok: true,
      now: {
        utcIso: now.toISOString(),
        parisIso: formatParisIso(now),
      },
      currentSession: currentSession
        ? {
            sessionDateIso: new Date(currentSession.sessionMs).toISOString(),
            offerExpiresIso: new Date(currentSession.offerMs).toISOString(),
            isLiveWindow:
              nowMs >= currentSession.sessionMs - 15 * 60 * 1000 && nowMs < currentSession.offerMs,
          }
        : null,
      sessionPopulation,
      video: {
        activeSource: cfg.activeSource,
        activeUrl: cfg.activeUrl,
        primaryUrl: cfg.sources.primary,
        backupUrl: cfg.sources.backup || null,
        checks: {
          active: activeCheck,
          primary: primaryCheck,
          backup: backupCheck,
        },
      },
      presence,
    });
  } catch (error) {
    console.error('admin-es2-cockpit-status error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};

