import { getStore } from '@netlify/blobs';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';
import { resolveActiveVideoConfig } from './lib/webinaire-video-config.mjs';

const PRESENCE_STORE = 'webinaire-live-presence';
const PRESENCE_PREFIX = 'presence:';
const PRESENCE_ACTIVE_MS = 45 * 1000;
const PRESENCE_BUDGET_MS = 2000;
const PRESENCE_BATCH_SIZE = 25;

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeoutId);
    return { ok: res.ok, status: res.status, error: null };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error?.name === 'AbortError';
    return {
      ok: false,
      status: null,
      error: isTimeout ? 'timeout 3s' : (error?.message || 'network error'),
    };
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

function buildSessionHistory(rows, nowMs) {
  const grouped = new Map();
  for (const r of rows) {
    const sessionMs = new Date(r.session_date).getTime();
    const offerMs = new Date(r.offre_expires_at).getTime();
    if (!Number.isFinite(sessionMs) || !Number.isFinite(offerMs)) continue;
    const key = `${sessionMs}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        sessionMs,
        offerMs,
        total: 0,
        inscrit: 0,
        present: 0,
        acheteur: 0,
        non_acheteur: 0,
        no_show: 0,
      });
    }
    const bucket = grouped.get(key);
    bucket.total += 1;
    if (r.statut === 'inscrit') bucket.inscrit += 1;
    else if (r.statut === 'present') bucket.present += 1;
    else if (r.statut === 'acheteur') bucket.acheteur += 1;
    else if (r.statut === 'non-acheteur') bucket.non_acheteur += 1;
    else if (r.statut === 'no-show') bucket.no_show += 1;
  }

  const sessions = Array.from(grouped.values()).sort((a, b) => b.sessionMs - a.sessionMs);
  const nextUpcoming = sessions
    .filter((s) => s.sessionMs > nowMs)
    .sort((a, b) => a.sessionMs - b.sessionMs)[0] || null;
  const pastSessions = sessions.filter((s) => s.offerMs <= nowMs).slice(0, 12);

  return { nextUpcoming, pastSessions };
}

function emptyPresence(extra = {}) {
  return {
    activeTotal: 0,
    waiting: 0,
    session: 0,
    replay: 0,
    stream: {
      sessionPlaying: 0,
      sessionPlayingReal: 0,
      sessionPlayingTest: 0,
      hasStream: false,
      mode: 'none',
      medianSecond: null,
      maxSecond: null,
    },
    ...extra,
  };
}

async function getPresenceCounts() {
  const startedAt = Date.now();

  let store;
  try {
    store = getStore(PRESENCE_STORE);
  } catch (error) {
    return emptyPresence({
      degraded: true,
      error: error?.message || 'presence store unavailable',
    });
  }

  let blobs = [];
  try {
    const listed = await store.list({ prefix: PRESENCE_PREFIX });
    blobs = listed?.blobs || [];
  } catch (error) {
    return emptyPresence({
      degraded: true,
      error: error?.message || 'presence list failed',
    });
  }

  let waiting = 0;
  let session = 0;
  let replay = 0;
  let activeTotal = 0;
  const sessionSeconds = [];
  let sessionPlaying = 0;
  let sessionPlayingReal = 0;
  let sessionPlayingTest = 0;
  let processed = 0;
  let degraded = false;
  const now = Date.now();

  function ingest(raw) {
    if (!raw) return;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const ts = Number(data?.ts || 0);
    if (!Number.isFinite(ts) || now - ts > PRESENCE_ACTIVE_MS) return;
    activeTotal += 1;
    if (data.stage === 'waiting') waiting += 1;
    else if (data.stage === 'replay') replay += 1;
    else {
      session += 1;
      if (Number.isFinite(Number(data.currentSecond))) {
        sessionSeconds.push(Number(data.currentSecond));
      }
      if (data.isPlaying) {
        sessionPlaying += 1;
        if (String(data.mode || 'real') === 'test') sessionPlayingTest += 1;
        else sessionPlayingReal += 1;
      }
    }
  }

  for (let i = 0; i < blobs.length; i += PRESENCE_BATCH_SIZE) {
    if (Date.now() - startedAt > PRESENCE_BUDGET_MS) {
      degraded = true;
      break;
    }
    const slice = blobs.slice(i, i + PRESENCE_BATCH_SIZE);
    const results = await Promise.allSettled(
      slice.map((item) => store.get(item.key)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') ingest(r.value);
    }
    processed += slice.length;
  }

  sessionSeconds.sort((a, b) => a - b);
  const medianSecond =
    sessionSeconds.length > 0
      ? sessionSeconds[Math.floor(sessionSeconds.length / 2)]
      : null;
  const maxSecond =
    sessionSeconds.length > 0 ? sessionSeconds[sessionSeconds.length - 1] : null;
  let mode = 'none';
  if (sessionPlaying > 0) {
    if (sessionPlayingReal > 0 && sessionPlayingTest > 0) mode = 'mixed';
    else if (sessionPlayingTest > 0) mode = 'test';
    else mode = 'real';
  }

  return {
    activeTotal,
    waiting,
    session,
    replay,
    stream: {
      sessionPlaying,
      sessionPlayingReal,
      sessionPlayingTest,
      hasStream: sessionPlaying > 0,
      mode,
      medianSecond,
      maxSecond,
    },
    degraded,
    processed,
    totalBlobs: blobs.length,
    durationMs: Date.now() - startedAt,
  };
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
    const sessionHistory = buildSessionHistory(rows, nowMs);

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
    const settled = await Promise.allSettled([
      headCheck(cfg.sources.primary),
      headCheck(cfg.sources.backup),
      headCheck(cfg.activeUrl),
    ]);
    const checkFallback = { ok: false, status: null, error: 'check failed' };
    const primaryCheck =
      settled[0].status === 'fulfilled' ? settled[0].value : checkFallback;
    const backupCheck =
      settled[1].status === 'fulfilled' ? settled[1].value : checkFallback;
    const activeCheck =
      settled[2].status === 'fulfilled' ? settled[2].value : checkFallback;
    // Hotfix: presence Blobs reads cause function timeouts (>10s).
    // Disabled until the store is cleaned up; cockpit shows the rest.
    const presence = emptyPresence({
      degraded: true,
      error: 'presence disabled (hotfix)',
    });

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
      nextSession: sessionHistory.nextUpcoming
        ? {
            sessionDateIso: new Date(sessionHistory.nextUpcoming.sessionMs).toISOString(),
            offerExpiresIso: new Date(sessionHistory.nextUpcoming.offerMs).toISOString(),
            population: {
              total: sessionHistory.nextUpcoming.total,
              inscrit: sessionHistory.nextUpcoming.inscrit,
              present: sessionHistory.nextUpcoming.present,
              acheteur: sessionHistory.nextUpcoming.acheteur,
              non_acheteur: sessionHistory.nextUpcoming.non_acheteur,
              no_show: sessionHistory.nextUpcoming.no_show,
            },
          }
        : null,
      pastSessions: sessionHistory.pastSessions.map((s) => ({
        sessionDateIso: new Date(s.sessionMs).toISOString(),
        offerExpiresIso: new Date(s.offerMs).toISOString(),
        isClosed: true,
        population: {
          total: s.total,
          inscrit: s.inscrit,
          present: s.present,
          acheteur: s.acheteur,
          non_acheteur: s.non_acheteur,
          no_show: s.no_show,
        },
      })),
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

