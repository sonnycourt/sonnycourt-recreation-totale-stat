import bcrypt from 'bcryptjs';
import {
  signSessionToken,
  buildSessionSetCookie,
} from './lib/admin-es2-crypto.mjs';
import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import { fetchAdminAuthRow, needsPasswordSetup, savePasswordHash } from './lib/admin-es2-supabase.mjs';
import { checkRateLimit, recordFailure, clearRateLimit } from './lib/admin-es2-rate-limit.mjs';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SEC = 24 * 60 * 60;
const MIN_LEN = 12;

function isSecure(req) {
  const proto = req.headers.get('x-forwarded-proto') || '';
  return proto === 'https';
}

function json(status, body, setCookie = null) {
  const headers = new Headers([
    ['Content-Type', 'application/json'],
    ['Cache-Control', 'no-store'],
  ]);
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function validatePair(password, confirm) {
  if (typeof password !== 'string' || typeof confirm !== 'string') return 'Données invalides.';
  if (password.length < MIN_LEN) return `Mot de passe trop court (minimum ${MIN_LEN} caractères).`;
  if (password !== confirm) return 'Les deux mots de passe ne correspondent pas.';
  return null;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const secret = getAdminEs2CookieSecret();
  if (!secret) {
    return json(500, { error: 'Supabase non configuré' });
  }

  const rowRes = await fetchAdminAuthRow();
  if (!rowRes.ok) {
    return json(500, { error: 'Impossible de lire la configuration (table ou droits Supabase).' });
  }
  if (!needsPasswordSetup(rowRes.row)) {
    return json(403, { error: 'Le mot de passe est déjà défini. Utilise la connexion ou « Changer le mot de passe ».' });
  }

  const rl = await checkRateLimit(req);
  if (rl.blocked) {
    const h = new Headers([
      ['Content-Type', 'application/json'],
      ['Cache-Control', 'no-store'],
      ['Retry-After', String(rl.retryAfterSec || 900)],
    ]);
    return new Response(JSON.stringify({ error: 'Trop de tentatives. Réessaie plus tard.' }), { status: 429, headers: h });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'JSON invalide' });
  }

  const msg = validatePair(body.password, body.confirm);
  if (msg) {
    await recordFailure(req);
    return json(400, { error: msg });
  }

  const hash = await bcrypt.hash(body.password, 12);
  const saved = await savePasswordHash(hash);
  if (!saved.ok) {
    return json(500, { error: 'Enregistrement impossible. Vérifie que la table admin_es2_auth existe (sql/admin_es2_auth.sql).' });
  }

  await clearRateLimit(req);

  const token = signSessionToken(secret, SESSION_TTL_MS);
  const cookie = buildSessionSetCookie({
    value: token,
    maxAgeSec: SESSION_MAX_AGE_SEC,
    secure: isSecure(req),
  });

  return json(200, { ok: true }, cookie);
};
