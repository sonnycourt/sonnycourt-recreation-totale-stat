import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  getCloserCookieSecret,
  getCloserCookieValue,
  verifyCloserToken,
} from './lib/closer-access-crypto.mjs';

/**
 * Console closer — chaque closer ne voit/édite QUE ses leads assignés.
 * GET  : liste mes leads.
 * POST { token, action:'log', outcome } : ajoute un appel horodaté (timestamp serveur).
 * POST { token, call_status?, call_notes?, call_transcript? } : maj des champs.
 */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

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

  if (req.method === 'GET') {
    const r = await supabaseGet(
      `webinaire_registrations?assigned_closer_id=eq.${cid}` +
        '&select=token,prenom,telephone,email,pays,watch_max_minutes,purchased,purchased_at,' +
        'call_status,call_notes,call_transcript,call_log' +
        '&order=purchased.asc,watch_max_minutes.desc',
    );
    if (!r.ok) return json(500, { error: 'Erreur lecture' });
    return json(200, { leads: Array.isArray(r.data) ? r.data : [] });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return json(400, { error: 'token manquant' });
    const where = `token=eq.${encodeURIComponent(token)}&assigned_closer_id=eq.${cid}`;

    // --- Noter un appel (horodaté côté serveur) ---
    if (body.action === 'log') {
      const outcome = typeof body.outcome === 'string' ? body.outcome.slice(0, 40) : '';
      const cur = await supabaseGet(`webinaire_registrations?${where}&select=call_log`);
      if (!cur.ok || !Array.isArray(cur.data) || !cur.data.length) {
        return json(404, { error: 'Lead introuvable' });
      }
      const log = Array.isArray(cur.data[0].call_log) ? cur.data[0].call_log : [];
      // Date/heure choisie par le closer (sinon maintenant).
      let atISO = new Date().toISOString();
      if (typeof body.at === 'string' && body.at) {
        const d = new Date(body.at);
        if (!Number.isNaN(d.getTime())) atISO = d.toISOString();
      }
      log.push({ at: atISO, outcome });
      const upd = await supabasePatch('webinaire_registrations', where, {
        call_log: log,
        call_count: log.length,
      });
      if (!upd.ok) return json(500, { error: 'Erreur log' });
      return json(200, { ok: true, call_log: log });
    }

    // --- Supprimer une tentative d'appel (par index) ---
    if (body.action === 'log-delete') {
      const idx = Number(body.index);
      const cur = await supabaseGet(`webinaire_registrations?${where}&select=call_log`);
      if (!cur.ok || !Array.isArray(cur.data) || !cur.data.length) {
        return json(404, { error: 'Lead introuvable' });
      }
      const log = Array.isArray(cur.data[0].call_log) ? cur.data[0].call_log : [];
      if (Number.isInteger(idx) && idx >= 0 && idx < log.length) log.splice(idx, 1);
      const upd = await supabasePatch('webinaire_registrations', where, {
        call_log: log,
        call_count: log.length,
      });
      if (!upd.ok) return json(500, { error: 'Erreur suppression' });
      return json(200, { ok: true, call_log: log });
    }

    // --- Maj des champs (auto-save) ---
    const patch = {};
    if (body.call_status !== undefined) {
      patch.call_status = body.call_status ? String(body.call_status).slice(0, 40) : null;
    }
    if (body.call_notes !== undefined) {
      patch.call_notes = body.call_notes ? String(body.call_notes).slice(0, 8000) : null;
    }
    if (body.call_transcript !== undefined) {
      patch.call_transcript = body.call_transcript ? String(body.call_transcript).slice(0, 8000) : null;
    }
    if (Object.keys(patch).length === 0) return json(400, { error: 'Rien à mettre à jour' });

    const upd = await supabasePatch('webinaire_registrations', where, patch);
    if (!upd.ok) return json(500, { error: 'Erreur écriture' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Méthode non autorisée' });
};
