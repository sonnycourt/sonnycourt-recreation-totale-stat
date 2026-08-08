import { signSessionToken, buildSessionSetCookie } from './lib/admin-es2-crypto.mjs';
import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import { verifyEmdHandoff } from './lib/admin-emd-sso.mjs';

function json(status, body, setCookie = null) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const host = String(req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (host !== 'emd.sonnycourt.com' && host !== 'localhost') return json(403, { error: 'Invalid host' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request' }); }
  const secret = getAdminEs2CookieSecret();
  const handoff = secret ? verifyEmdHandoff(body?.token, secret) : null;
  if (!handoff) return json(401, { error: 'Handoff expired' });

  const ttlMs = Math.min(24 * 60 * 60 * 1000, handoff.sessionExp - Date.now());
  if (ttlMs <= 0) return json(401, { error: 'Session expired' });
  const sessionToken = signSessionToken(secret, ttlMs);
  const cookie = buildSessionSetCookie({
    value: sessionToken,
    maxAgeSec: Math.max(1, Math.floor(ttlMs / 1000)),
    secure: host === 'emd.sonnycourt.com',
  });
  return json(200, { ok: true }, cookie);
};

