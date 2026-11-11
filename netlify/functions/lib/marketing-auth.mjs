import crypto from 'node:crypto';
import { getAdminEs2CookieSecret } from './admin-es2-session-secret.mjs';
import { fetchAdminAuthRow, needsPasswordSetup } from './admin-es2-supabase.mjs';

export const SESSION_COOKIE = '__Host-link_studio';
export const SESSION_SECONDS = 30 * 86400;
function key(hash) {
  const secret = getAdminEs2CookieSecret();
  if (!secret || !hash) throw new Error('auth_unavailable');
  return crypto.createHmac('sha256', secret).update(`link-studio-session-v1|${hash}`).digest();
}
export function signMarketingSession(hash, now = Date.now()) {
  const data = Buffer.from(JSON.stringify({aud:'link-studio',iat:now,exp:now+SESSION_SECONDS*1000})).toString('base64url');
  return data+'.'+crypto.createHmac('sha256',key(hash)).update(data).digest('hex');
}
export function verifyMarketingSession(token, hash, now = Date.now()) {
  try {
    if (typeof token!=='string' || token.length>600) return null;
    const [data,sig,extra]=token.split('.');
    if (extra!==undefined || !/^[a-f0-9]{64}$/.test(sig)) return null;
    const expected=crypto.createHmac('sha256',key(hash)).update(data).digest();
    if (!crypto.timingSafeEqual(Buffer.from(sig,'hex'),expected)) return null;
    const session=JSON.parse(Buffer.from(data,'base64url').toString());
    return session.aud==='link-studio' && Number.isFinite(session.iat) && session.iat<=now && session.exp>now && session.exp-session.iat===SESSION_SECONDS*1000 ? session : null;
  } catch { return null; }
}
export async function getMarketingSession(req, readAuth=fetchAdminAuthRow) {
  const value=(req.headers.get('cookie')||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);
  if (!value || value.length>600) return null;
  const auth=await readAuth();
  return auth.ok && !needsPasswordSetup(auth.row) ? verifyMarketingSession(value,auth.row.password_hash) : null;
}
export function marketingSessionCookie(token='') {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${token?SESSION_SECONDS:0}; HttpOnly; Secure; SameSite=Strict`;
}
