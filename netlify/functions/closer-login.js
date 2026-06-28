import bcrypt from 'bcryptjs';
import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  getCloserCookieSecret,
  signCloserToken,
  buildCloserSetCookie,
} from './lib/closer-access-crypto.mjs';

/**
 * Login closer par email + mot de passe (créés par l'admin).
 * Pose le même cookie signé `closer_access` (cid) que closer-access -> la
 * console et la documentation reconnaissent le closer sans changement.
 * La vérification de session (au chargement) reste sur closer-access (GET).
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function json(status, body, setCookie) {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (setCookie) res.headers.append('Set-Cookie', setCookie);
  return res;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json(400, { error: 'Requête invalide' });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return json(400, { error: 'Email et mot de passe requis.' });

  const r = await supabaseGet(
    `closer_access_codes?email=eq.${encodeURIComponent(email)}&active=eq.true` +
      '&select=id,password_hash,active',
  );
  const row = r.ok && Array.isArray(r.data) && r.data.length ? r.data[0] : null;
  // Toujours comparer (timing) même si pas de hash, pour ne pas révéler l'existence.
  const hash = row && row.password_hash ? row.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);
  if (!row || !row.password_hash || !ok) {
    return json(401, { error: 'Identifiants invalides.' });
  }

  const secret = getCloserCookieSecret();
  const token = signCloserToken(secret, TTL_MS, Number(row.id));
  let secure = true;
  try {
    secure = (req.headers.get('x-forwarded-proto') || new URL(req.url).protocol).includes('https');
  } catch (e) {
    /* noop */
  }
  const cookie = buildCloserSetCookie({
    value: token,
    maxAgeSec: Math.floor(TTL_MS / 1000),
    secure,
  });

  // Trace de connexion (best-effort).
  try {
    await supabasePatch('closer_access_codes', `id=eq.${Number(row.id)}`, {
      last_visit_at: new Date().toISOString(),
    });
  } catch (e) {
    /* noop */
  }

  return json(200, { ok: true }, cookie);
};
