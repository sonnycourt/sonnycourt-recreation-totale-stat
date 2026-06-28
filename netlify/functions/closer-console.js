import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  getCloserCookieSecret,
  getCloserCookieValue,
  verifyCloserToken,
} from './lib/closer-access-crypto.mjs';

/**
 * Console closer — chaque closer ne voit/édite QUE les leads qui lui sont
 * assignés (assigned_closer_id = son cid, déduit du cookie signé closer_access).
 * GET  : liste mes leads.
 * POST : met à jour { token, call_status?, call_count?, call_transcript? }.
 */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** @returns {number|null} cid du closer authentifié, ou null. */
function authCloserId(req) {
  const secret = getCloserCookieSecret();
  if (!secret) return null;
  const data = verifyCloserToken(getCloserCookieValue(req.headers.get('cookie') || ''), secret);
  if (!data || !Number.isInteger(data.cid)) return null;
  return data.cid;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const cid = authCloserId(req);
  if (cid === null) return json(401, { error: 'Non authentifié' });

  // --- Mes leads assignés ---
  if (req.method === 'GET') {
    const r = await supabaseGet(
      `webinaire_registrations?assigned_closer_id=eq.${cid}` +
        '&select=token,prenom,telephone,email,pays,watch_max_minutes,purchased,purchased_at,' +
        'call_count,call_status,call_transcript,session_date' +
        '&order=purchased.asc,watch_max_minutes.desc',
    );
    if (!r.ok) return json(500, { error: 'Erreur lecture' });
    return json(200, { leads: Array.isArray(r.data) ? r.data : [] });
  }

  // --- Mise à jour d'un lead (uniquement s'il m'est assigné) ---
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return json(400, { error: 'token manquant' });

    const patch = {};
    if (body.call_status !== undefined) {
      patch.call_status = body.call_status ? String(body.call_status).slice(0, 40) : null;
    }
    if (body.call_transcript !== undefined) {
      patch.call_transcript = body.call_transcript ? String(body.call_transcript).slice(0, 5000) : null;
    }
    if (body.call_count !== undefined) {
      const n = Number(body.call_count);
      if (Number.isFinite(n) && n >= 0) patch.call_count = Math.floor(n);
    }
    if (Object.keys(patch).length === 0) return json(400, { error: 'Rien à mettre à jour' });

    // Sécurité : le filtre double (token + assigned_closer_id=cid) garantit
    // qu'un closer ne peut éditer que SES leads.
    const upd = await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(token)}&assigned_closer_id=eq.${cid}`,
      patch,
    );
    if (!upd.ok) return json(500, { error: 'Erreur écriture' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Méthode non autorisée' });
};
