import { getStore } from '@netlify/blobs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  signCloserToken,
  verifyCloserToken,
  getCloserCookieSecret,
  getCloserCookieValue,
  buildCloserSetCookie,
} from './lib/closer-access-crypto.mjs';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;      // session valide 30 jours
const MAX_AGE_SEC = 30 * 24 * 60 * 60;
const VISIT_THROTTLE_MS = 30 * 60 * 1000;     // anti-inflation : 1 visite comptée / 30 min max

// Rate-limit dédié (store distinct de l'admin)
const RL_STORE = 'closer-access-rl';
const RL_MAX_FAILS = 10;
const RL_BLOCK_MS = 15 * 60 * 1000;

const CODE_RE = /^[A-Z0-9-]{4,40}$/;

function isSecure(req) {
  return (req.headers.get('x-forwarded-proto') || '') === 'https';
}

function json(status, body, setCookie = null) {
  const headers = new Headers([
    ['Content-Type', 'application/json'],
    ['Cache-Control', 'no-store'],
  ]);
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function clientIp(req) {
  const xf = req.headers.get('x-forwarded-for') || '';
  if (xf) return xf.split(',')[0].trim().slice(0, 64) || 'unknown';
  return (req.headers.get('x-nf-client-connection-ip') || 'unknown').slice(0, 64);
}

async function checkRl(req) {
  try {
    const store = getStore(RL_STORE);
    const raw = await store.get(`rl:${clientIp(req)}`);
    if (!raw) return { blocked: false };
    const blockedUntil = Number(JSON.parse(raw).blockedUntil) || 0;
    if (blockedUntil > Date.now()) return { blocked: true, retryAfterSec: Math.ceil((blockedUntil - Date.now()) / 1000) };
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

async function recordRlFailure(req) {
  try {
    const store = getStore(RL_STORE);
    const key = `rl:${clientIp(req)}`;
    const raw = await store.get(key);
    let fails = 0;
    if (raw) fails = Number(JSON.parse(raw).fails) || 0;
    fails += 1;
    let blockedUntil = 0;
    if (fails >= RL_MAX_FAILS) {
      blockedUntil = Date.now() + RL_BLOCK_MS;
      fails = 0;
    }
    await store.set(key, JSON.stringify({ fails, blockedUntil }));
  } catch {
    /* ignore */
  }
}

async function clearRl(req) {
  try {
    await getStore(RL_STORE).delete(`rl:${clientIp(req)}`);
  } catch {
    /* ignore */
  }
}

/** Incrémente le compteur (throttle) + maj des dates de visite. */
async function recordVisit(row, fresh, consent) {
  const nowIso = new Date().toISOString();
  const patch = { last_visit_at: nowIso };
  if (!row.first_visit_at) patch.first_visit_at = nowIso;
  const last = row.last_visit_at ? Date.parse(row.last_visit_at) : 0;
  const shouldCount = fresh || !last || Date.now() - last > VISIT_THROTTLE_MS;
  if (shouldCount) patch.visit_count = (Number(row.visit_count) || 0) + 1;
  // Trace de l'acceptation de confidentialité (première fois)
  if (consent && !row.consent_at) patch.consent_at = nowIso;
  await supabasePatch('closer_access_codes', `id=eq.${Number(row.id)}`, patch);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const secret = getCloserCookieSecret();
  if (!secret) return json(500, { error: 'Service non configuré' });

  // --- Vérification de session (au chargement de la page) ---
  if (req.method === 'GET') {
    const data = verifyCloserToken(getCloserCookieValue(req.headers.get('cookie') || ''), secret);
    if (!data || !Number.isInteger(data.cid)) return json(200, { authenticated: false });

    const r = await supabaseGet(
      `closer_access_codes?id=eq.${Number(data.cid)}&active=eq.true&select=id,label,active,visit_count,first_visit_at,last_visit_at,consent_at`
    );
    const rows = Array.isArray(r.data) ? r.data : [];
    if (!r.ok || rows.length === 0) return json(200, { authenticated: false });

    await recordVisit(rows[0], false, false);
    return json(200, { authenticated: true });
  }

  // --- Soumission d'un code ---
  if (req.method === 'POST') {
    const rl = await checkRl(req);
    if (rl.blocked) {
      return new Response(JSON.stringify({ error: 'Trop de tentatives. Réessayez plus tard.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': String(rl.retryAfterSec || 900) },
      });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'Requête invalide' });
    }

    // Consentement confidentialité obligatoire (case cochée côté client, vérifiée ici)
    if (body.consent !== true) {
      return json(400, { error: 'Vous devez accepter la confidentialité.' });
    }

    const code = (typeof body.code === 'string' ? body.code : '').trim().toUpperCase();
    if (!code || !CODE_RE.test(code)) {
      await recordRlFailure(req);
      return json(401, { error: 'Code invalide.' });
    }

    const r = await supabaseGet(
      `closer_access_codes?code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,label,active,visit_count,first_visit_at,last_visit_at,consent_at`
    );
    const rows = Array.isArray(r.data) ? r.data : [];
    if (!r.ok || rows.length === 0) {
      await recordRlFailure(req);
      return json(401, { error: 'Code invalide.' });
    }

    const row = rows[0];
    await recordVisit(row, true, true);
    await clearRl(req);

    const token = signCloserToken(secret, TTL_MS, Number(row.id));
    const cookie = buildCloserSetCookie({ value: token, maxAgeSec: MAX_AGE_SEC, secure: isSecure(req) });
    return json(200, { ok: true }, cookie);
  }

  return json(405, { error: 'Method not allowed' });
};
