import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  getCloserCookieSecret,
  getCloserCookieValue,
  verifyCloserToken,
} from './lib/closer-access-crypto.mjs';

/**
 * Console closer — chaque closer ne voit/édite QUE ses leads assignés.
 * GET  : liste mes leads.
 * POST { token, action:'log', outcome, at?, call_status?, next_callback_at? } : ajoute un appel horodaté + maj statut/rappel.
 * POST { token, action:'log-delete', index } : supprime une tentative.
 * POST { token, call_status?, next_callback_at?, call_notes?, call_transcript? } : maj des champs (auto-save).
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
  return data && Number.isInteger(data.cid) ? data.cid : null;
}

/** null -> null (effacer) · vide/invalide -> undefined (ne pas toucher) · valide -> ISO. */
function dateOrNull(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const cid = authCloserId(req);
  if (cid === null) return json(401, { error: 'Non authentifié' });

  if (req.method === 'GET') {
    const r = await supabaseGet(
      `webinaire_registrations?assigned_closer_id=eq.${cid}` +
        '&select=token,prenom,telephone,email,pays,watch_max_minutes,purchased,purchased_at,' +
        'call_status,next_callback_at,call_notes,call_transcript,call_log' +
        '&order=watch_max_minutes.desc',
    );
    if (!r.ok) return json(500, { error: 'Erreur lecture' });
    return json(200, { leads: Array.isArray(r.data) ? r.data : [] });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return json(400, { error: 'token manquant' });
    const where = `token=eq.${encodeURIComponent(token)}&assigned_closer_id=eq.${cid}`;

    // --- Noter une tentative d'appel (+ maj statut/rappel) ---
    if (body.action === 'log') {
      const outcome = typeof body.outcome === 'string' ? body.outcome.slice(0, 40) : '';
      const cur = await supabaseGet(`webinaire_registrations?${where}&select=call_log`);
      if (!cur.ok || !Array.isArray(cur.data) || !cur.data.length) {
        return json(404, { error: 'Lead introuvable' });
      }
      const log = Array.isArray(cur.data[0].call_log) ? cur.data[0].call_log : [];
      let atISO = new Date().toISOString();
      const at = dateOrNull(body.at);
      if (at) atISO = at;
      log.push({ at: atISO, outcome });

      const patch = { call_log: log, call_count: log.length };
      if (typeof body.call_status === 'string') {
        patch.call_status = body.call_status ? body.call_status.slice(0, 40) : null;
      }
      const cb = dateOrNull(body.next_callback_at);
      if (cb !== undefined) patch.next_callback_at = cb;

      const upd = await supabasePatch('webinaire_registrations', where, patch);
      if (!upd.ok) return json(500, { error: 'Erreur log' });
      return json(200, { ok: true, call_log: log });
    }

    // --- Supprimer une tentative ---
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
    if (typeof body.call_status === 'string') {
      patch.call_status = body.call_status ? body.call_status.slice(0, 40) : null;
    }
    if (body.next_callback_at !== undefined) {
      const cb = dateOrNull(body.next_callback_at);
      if (cb !== undefined) patch.next_callback_at = cb;
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
