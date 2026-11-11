import { buildDestination, CODE } from '../../src/lib/marketing-links-contract.mjs';
import { database } from './lib/marketing-links.mjs';
import { bioLinkForPath } from '../../src/lib/marketing-bio-links.mjs';

export default async function handler(req) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' };
  if (!['GET', 'HEAD'].includes(req.method)) return new Response('Méthode non autorisée.', { status: 405, headers });
  const url = new URL(req.url);
  // Netlify v2 keeps the original public URL when a redirect rewrites to a
  // function. Read the code from /r/... first; query parameters cannot replace it.
  const code = url.pathname.startsWith('/masterclass/') || url.pathname.startsWith('/links/')
    ? bioLinkForPath(url.pathname)?.code
    : url.pathname.startsWith('/r/')
    ? url.pathname.match(/^\/r\/([a-f0-9]{12})\/?$/)?.[1]
    : url.searchParams.get('code');
  if (!CODE.test(code || '')) return new Response('Lien introuvable.', { status: 404, headers });
  try {
    const rows = await database(`marketing_links?code=eq.${code}&select=code,destination,channel,placement,campaign&limit=1`);
    if (!rows?.[0]) return new Response('Lien introuvable.', { status: 404, headers });
    // Incoming UTM, destination or personal parameters are deliberately ignored.
    // No click is recorded here: email scanners and link previews follow redirects.
    const target = new URL(buildDestination(rows[0]));
    // Ad platforms append click IDs after link creation. Keep these through the
    // redirect so the existing Meta matching does not lose its fbc / click context.
    for (const key of ['fbclid','ttclid','gclid','msclkid']) {
      const value = url.searchParams.get(key);
      if (value && /^[a-zA-Z0-9_.-]{1,512}$/.test(value)) target.searchParams.set(key,value);
    }
    return new Response(null, { status: 302, headers: { ...headers, Location: target.href } });
  } catch {
    return new Response('Ce lien est momentanément indisponible. Réessaie dans quelques instants.', { status: 503, headers: { ...headers, 'Retry-After': '15' } });
  }
}
