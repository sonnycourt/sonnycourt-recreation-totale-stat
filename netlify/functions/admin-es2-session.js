import { verifySessionToken, getSessionCookieValue } from './lib/admin-es2-crypto.mjs';
import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import { fetchAdminAuthRow, needsPasswordSetup } from './lib/admin-es2-supabase.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (req.method !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const secret = getAdminEs2CookieSecret();
  if (!secret) {
    return json(500, { error: 'Server misconfigured' });
  }

  const rowRes = await fetchAdminAuthRow();
  if (!rowRes.ok || needsPasswordSetup(rowRes.row)) {
    return json(401, { authenticated: false, needsSetup: true });
  }

  const raw = getSessionCookieValue(req.headers.get('cookie') || '');
  const session = verifySessionToken(raw, secret);
  if (!session) {
    return json(401, { authenticated: false });
  }

  return json(200, { authenticated: true, exp: session.exp });
};
