import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import { signEmdHandoff } from './lib/admin-emd-sso.mjs';

function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const session = getSessionFromRequest(req);
  if (!session) return redirect('https://sonnycourt.com/hub?destination=emd');
  const secret = getAdminEs2CookieSecret();
  if (!secret) return new Response('SSO unavailable', { status: 503 });
  const token = signEmdHandoff(secret, session.exp);
  return redirect(`https://emd.sonnycourt.com/sso#${encodeURIComponent(token)}`);
};

