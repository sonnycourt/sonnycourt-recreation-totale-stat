import bcrypt from 'bcryptjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  getSetterCookieSecret,
  signSetterToken,
  buildSetterSetCookie,
  authSetterUserId,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginRateLimit,
  COOKIE_NAME,
} from './lib/setter-auth.mjs';

/**
 * Login console /setter.
 * GET  : { authenticated } (vérifie la session en cours)
 * POST { email, password } : connexion (3 tentatives/heure/IP max)
 * POST { action:'logout' } : déconnexion
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  if (req.method === 'GET') {
    const uid = await authSetterUserId(req);
    return json(200, { authenticated: uid !== null });
  }

  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  const body = await req.json().catch(() => ({}));

  if (body.action === 'logout') {
    return json(200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure` });
  }

  const rl = await checkLoginRateLimit(req);
  if (rl.blocked) {
    return json(429, { error: `Trop de tentatives. Réessaie dans ${Math.ceil((rl.retryAfterSec || 3600) / 60)} min.` });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return json(400, { error: 'Email et mot de passe requis' });

  const r = await supabaseGet(
    `setter_users?email=eq.${encodeURIComponent(email)}&active=eq.true&select=id,password_hash`,
  );
  const row = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
  // Hash factice si utilisateur inconnu : temps de réponse constant (anti-énumération).
  const hash = row && row.password_hash ? row.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);

  if (!row || !ok) {
    const after = await recordLoginFailure(req);
    if (after.blocked) {
      return json(429, { error: `Trop de tentatives. Réessaie dans ${Math.ceil((after.retryAfterSec || 3600) / 60)} min.` });
    }
    return json(401, { error: 'Identifiants invalides' });
  }

  await clearLoginRateLimit(req);
  await supabasePatch('setter_users', `id=eq.${row.id}`, { last_login_at: new Date().toISOString() }).catch(() => {});
  const token = signSetterToken(getSetterCookieSecret(), SESSION_TTL_MS, row.id);
  return json(200, { ok: true }, { 'Set-Cookie': buildSetterSetCookie(token, SESSION_TTL_MS / 1000) });
};
