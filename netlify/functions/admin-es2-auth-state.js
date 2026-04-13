import { getAdminEs2CookieSecret } from './lib/admin-es2-session-secret.mjs';
import { verifySessionToken, getSessionCookieValue } from './lib/admin-es2-crypto.mjs';
import { fetchAdminAuthRow, needsPasswordSetup } from './lib/admin-es2-supabase.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const secret = getAdminEs2CookieSecret();
  if (!secret) {
    return json(200, {
      supabaseConfigured: false,
      needsSetup: false,
      authenticated: false,
      dbError: false,
      message: 'Variables Netlify manquantes : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.',
    });
  }

  const rowRes = await fetchAdminAuthRow();
  if (!rowRes.ok) {
    return json(200, {
      supabaseConfigured: true,
      needsSetup: false,
      authenticated: false,
      dbError: true,
      message:
        'Impossible de lire la table admin (souvent : table absente). Dans Supabase → SQL Editor, exécute une fois le fichier sql/admin_es2_auth.sql du dépôt, puis recharge cette page.',
    });
  }

  const needsSetup = needsPasswordSetup(rowRes.row);
  const raw = getSessionCookieValue(req.headers.get('cookie') || '');
  const session = secret ? verifySessionToken(raw, secret) : null;
  const authenticated = Boolean(session && !needsSetup);

  return json(200, {
    supabaseConfigured: true,
    needsSetup,
    authenticated,
    dbError: false,
  });
};
