import bcrypt from 'bcryptjs';
import {
  signSessionToken,
  buildSessionSetCookie,
} from './lib/admin-es2-crypto.mjs';
import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import { fetchAdminAuthRow, needsPasswordSetup } from './lib/admin-es2-supabase.mjs';
import { checkRateLimit, recordFailure, clearRateLimit } from './lib/admin-es2-rate-limit.mjs';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SEC = 24 * 60 * 60;

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

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const secret = getAdminEs2CookieSecret();
  if (!secret) {
    return json(500, { error: 'Supabase non configuré sur Netlify' });
  }

  const rowRes = await fetchAdminAuthRow();
  if (!rowRes.ok) {
    return json(500, { error: 'Table ou accès Supabase : exécute sql/admin_es2_auth.sql une fois.' });
  }
  if (needsPasswordSetup(rowRes.row)) {
    return json(400, { error: 'Première configuration requise', code: 'SETUP_REQUIRED' });
  }

  const hash = rowRes.row.password_hash;

  const rl = await checkRateLimit(req);
  if (rl.blocked) {
    const h = new Headers([
      ['Content-Type', 'application/json'],
      ['Cache-Control', 'no-store'],
      ['Retry-After', String(rl.retryAfterSec || 900)],
    ]);
    return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429, headers: h });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return json(400, { error: 'Password required' });
  }

  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    const rf = await recordFailure(req);
    if (rf.blocked) {
      const h = new Headers([
        ['Content-Type', 'application/json'],
        ['Cache-Control', 'no-store'],
        ['Retry-After', String(rf.retryAfterSec || 900)],
      ]);
      return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429, headers: h });
    }
    return json(401, { error: 'Invalid password' });
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
