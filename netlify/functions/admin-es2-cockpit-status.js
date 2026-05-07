import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';
import { resolveActiveVideoConfig } from './lib/webinaire-video-config.mjs';

// 90s = couvre le ping client à 60s + 30s de buffer (sinon le compteur clignote entre 2 pings)
const PRESENCE_ACTIVE_MS = 90 * 1000;

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

async function fetchAllStatusRows() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return [];
  const pageSize = 1000;
  let offset = 0;
  const out = [];
  while (true) {
    const qs = new URLSearchParams({
      select: 'session_date,offre_expires_at,statut,attended_live,watched_replay',
      order: 'session_date.desc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const res = await fetch(`${url}/rest/v1/webinaire_registrations?${qs.toString()}`, {
      headers: supabaseHeaders(),
    });
    if (!res.ok) break;
    const json = await res.json().catch(() => []);
    const batch = Array.isArray(json) ? json : [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return out;
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
        inscrit: 0,
        presents_live: 0,
        presents_replay: 0,
        presents_total: 0,
      });
    }
    const bucket = grouped.get(key);
    bucket.inscrit += 1;
    const live = r.attended_live === true;
    const replay = r.watched_replay === true;
    if (live) bucket.presents_live += 1;
    if (replay) bucket.presents_replay += 1;
    if (live || replay) bucket.presents_total += 1;
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
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return emptyPresence({ degraded: true, error: 'supabase non configuré' });
  }

  const cutoffIso = new Date(Date.now() - PRESENCE_ACTIVE_MS).toISOString();
  const qs = new URLSearchParams({
    select: 'stage,current_second,is_playing,mode',
    updated_at: `gte.${cutoffIso}`,
    limit: '5000',
  });

  let rows = [];
  try {
    const res = await fetch(`${url}/rest/v1/webinaire_presence?${qs.toString()}`, {
      headers: supabaseHeaders(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return emptyPresence({
        degraded: true,
        error: `presence query http_${res.status}: ${errText.slice(0, 120)}`,
      });
    }
    const json = await res.json().catch(() => []);
    rows = Array.isArray(json) ? json : [];
  } catch (error) {
    return emptyPresence({
      degraded: true,
      error: error?.message || 'presence query failed',
    });
  }

  let waiting = 0;
  let session = 0;
  let replay = 0;
  const sessionSeconds = [];
  let sessionPlaying = 0;
  let sessionPlayingReal = 0;
  let sessionPlayingTest = 0;

  for (const r of rows) {
    if (r?.stage === 'waiting') waiting += 1;
    else if (r?.stage === 'replay') replay += 1;
    else {
      session += 1;
      const sec = Number(r?.current_second);
      if (Number.isFinite(sec)) sessionSeconds.push(sec);
      if (r?.is_playing) {
        sessionPlaying += 1;
        if (String(r?.mode || 'real') === 'test') sessionPlayingTest += 1;
        else sessionPlayingReal += 1;
      }
    }
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
    activeTotal: rows.length,
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
    degraded: false,
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
    const rows = await fetchAllStatusRows();
    const currentSession = pickCurrentSession(rows, nowMs);
    const sessionHistory = buildSessionHistory(rows, nowMs);

    let sessionPopulation = {
      inscrit: 0,
      presents_live: 0,
      presents_replay: 0,
      presents_total: 0,
    };
    if (currentSession) {
      for (const r of rows) {
        const ms = new Date(r.session_date).getTime();
        if (ms !== currentSession.sessionMs) continue;
        sessionPopulation.inscrit += 1;
        const live = r.attended_live === true;
        const replay = r.watched_replay === true;
        if (live) sessionPopulation.presents_live += 1;
        if (replay) sessionPopulation.presents_replay += 1;
        if (live || replay) sessionPopulation.presents_total += 1;
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
    let presence;
    try {
      presence = await getPresenceCounts();
    } catch (error) {
      presence = emptyPresence({
        degraded: true,
        error: error?.message || 'presence error',
      });
    }

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
              inscrit: sessionHistory.nextUpcoming.inscrit,
              presents_live: sessionHistory.nextUpcoming.presents_live,
              presents_replay: sessionHistory.nextUpcoming.presents_replay,
              presents_total: sessionHistory.nextUpcoming.presents_total,
            },
          }
        : null,
      pastSessions: sessionHistory.pastSessions.map((s) => ({
        sessionDateIso: new Date(s.sessionMs).toISOString(),
        offerExpiresIso: new Date(s.offerMs).toISOString(),
        isClosed: true,
        population: {
          inscrit: s.inscrit,
          presents_live: s.presents_live,
          presents_replay: s.presents_replay,
          presents_total: s.presents_total,
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

