import { verifySessionToken, getSessionCookieValue } from './admin-es2-crypto.mjs';
import { getAdminEs2CookieSecret } from './admin-es2-session-secret.mjs';

export function getSessionFromRequest(req) {
  const secret = getAdminEs2CookieSecret();
  if (!secret) return null;
  const raw = getSessionCookieValue(req.headers.get('cookie') || '');
  return verifySessionToken(raw, secret);
}
