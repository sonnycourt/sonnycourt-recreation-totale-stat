import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { readPageviews, reply } from './lib/delta-pageviews.mjs';
export default async function handler(req) {
  if (req.method !== 'GET') return reply(405, { error: 'Méthode non autorisée.' });
  if ((req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { error: 'Accès refusé.' });
  if (!getSessionFromRequest(req)) return reply(401, { error: 'Connexion administrateur requise.' });
  const q = new URL(req.url).searchParams, from = Date.parse(q.get('from')), to = Date.parse(q.get('to'));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 32 * 86400000 || from < Date.now() - 90 * 86400000 || to > Date.now() + 86400000 || from % 3600000 || to % 3600000) return reply(400, { error: 'Période de 31 jours maximum, bornes à l’heure entière, dans les 90 derniers jours.' });
  try { return reply(200, { ...await readPageviews(from, to), from: new Date(from).toISOString(), to: new Date(to).toISOString() }); }
  catch { return reply(503, { error: 'Compteur indisponible ou période trop volumineuse. Réduis la période ; aucun total partiel affiché.' }); }
}
