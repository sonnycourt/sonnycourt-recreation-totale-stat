import { buildSessionClearCookie } from './lib/admin-es2-crypto.mjs';

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
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://sonnycourt.com',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const secure = isSecure(req);
  const cookie = buildSessionClearCookie(secure);

  return json(200, { ok: true }, cookie);
};
