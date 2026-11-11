import crypto from 'node:crypto';
import { CODE, UUID } from '../../src/lib/marketing-links-contract.mjs';
import { COOKIE, MAX_AGE, cookieValue, database, isDestinationPath, json, productionRequest, sameOrigin, sign, verify, visitorCookie } from './lib/marketing-links.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  if (!sameOrigin(req, true)) return json(403, { error: 'Accès refusé.' });
  if (!productionRequest(req)) return json(200, { skipped: 'preview' });
  if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'Format invalide.' });
  try {
    const raw = await req.text(); if (raw.length > 1200) return json(413, { error: 'Requête trop grande.' });
    const body = JSON.parse(raw);
    if (body.revoke === true) return json(200, { ok: true }, { 'Set-Cookie': visitorCookie('', 0) });
    if (!CODE.test(body.code || '') || !UUID.test(body.event_id || '') || body.visible !== true) return json(400, { error: 'Arrivée invalide.' });
    if (/bot|spider|crawler|preview|facebookexternalhit|slackbot|headless/i.test(req.headers.get('user-agent') || '')) return json(200, { skipped: 'automated' });
    const [link] = await database(`marketing_links?code=eq.${body.code}&select=id,destination&limit=1`);
    if (!link || !isDestinationPath(link.destination, body.path)) return json(400, { error: 'Destination invalide.' });
    // No persistent ID, IP, user agent, email or full URL is stored without consent.
    let visitor = null;
    if (body.statistics_consent === true) {
      const old = verify('visitor', cookieValue(req, COOKIE));
      visitor = old && UUID.test(old.id || '') ? old.id : crypto.randomUUID();
    }
    const rows = await database('rpc/marketing_record_arrival', { p_event_id: body.event_id, p_link_id: link.id, p_visitor_id: visitor });
    // Use the persisted row on retry, never mint a different identity for one event.
    const row = rows?.[0] || rows;
    if (!row || row.link_id !== link.id) return json(409, { error: 'Arrivée déjà enregistrée sur un autre lien.' });
    const receipt = sign('arrival', { event_id: row.id, code: body.code, exp: Date.now() + 86400000 });
    const cookie = row.visitor_id && body.statistics_consent === true
      ? visitorCookie(sign('visitor', { id: row.visitor_id, exp: Date.now() + MAX_AGE * 1000 }))
      : visitorCookie('', 0);
    return json(200, { ok: true, receipt }, { 'Set-Cookie': cookie });
  } catch { return json(503, { error: 'Mesure indisponible.' }); }
}
export const config = { rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
