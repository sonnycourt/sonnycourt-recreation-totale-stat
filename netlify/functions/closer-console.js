import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  getCloserCookieSecret,
  getCloserCookieValue,
  verifyCloserToken,
} from './lib/closer-access-crypto.mjs';

/**
 * Console closer — chaque closer ne voit/édite QUE ses leads assignés.
 * Le STATUT du lead est DÉRIVÉ de la dernière tentative d'appel (jamais saisi
 * à la main) -> toujours cohérent avec l'historique. Vidé -> "À appeler".
 *
 * GET  : liste mes leads.
 * POST { token, action:'log', outcome, at?, callback? } : ajoute une tentative (callback si "Rappel demandé").
 * POST { token, action:'log-delete', index } : supprime une tentative.
 * POST { token, call_notes?, call_transcript? } : notes/transcript (auto-save).
 */

const OUTCOME_STATUS = {
  'Pas de reponse': null,
  Messagerie: null,
  Joint: 'En reflexion',
  'Rappel demande': 'A rappeler',
  'A dit OUI': 'Dit oui (verbal)',
  Refus: 'Refuse',
  'Faux numero': 'Injoignable',
};

/** Statut + rappel dérivés de la dernière tentative. Historique vide -> à appeler. */
function derive(log) {
  if (!Array.isArray(log) || !log.length) return { call_status: null, next_callback_at: null };
  const last = log[log.length - 1];
  const status = Object.prototype.hasOwnProperty.call(OUTCOME_STATUS, last.outcome)
    ? OUTCOME_STATUS[last.outcome]
    : null;
  const cb = last.outcome === 'Rappel demande' && last.callback ? last.callback : null;
  return { call_status: status, next_callback_at: cb };
}

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

function dateISO(v) {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const cid = authCloserId(req);
  if (cid === null) return json(401, { error: 'Non authentifié' });

  if (req.method === 'GET') {
    const r = await supabaseGet(
      `webinaire_registrations?assigned_closer_id=eq.${cid}` +
        '&select=token,prenom,telephone,email,pays,watch_max_minutes,purchased,purchased_at,' +
        'session_date,call_status,next_callback_at,call_notes,call_transcript,call_log' +
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

    // --- Noter une tentative -> statut dérivé ---
    if (body.action === 'log') {
      const outcome = typeof body.outcome === 'string' ? body.outcome.slice(0, 40) : '';
      const cur = await supabaseGet(`webinaire_registrations?${where}&select=call_log`);
      if (!cur.ok || !Array.isArray(cur.data) || !cur.data.length) {
        return json(404, { error: 'Lead introuvable' });
      }
      const log = Array.isArray(cur.data[0].call_log) ? cur.data[0].call_log : [];
      const entry = { at: dateISO(body.at) || new Date().toISOString(), outcome };
      const cb = dateISO(body.callback);
      if (outcome === 'Rappel demande' && cb) entry.callback = cb;
      log.push(entry);

      const d = derive(log);
      const upd = await supabasePatch('webinaire_registrations', where, {
        call_log: log,
        call_count: log.length,
        call_status: d.call_status,
        next_callback_at: d.next_callback_at,
      });
      if (!upd.ok) return json(500, { error: 'Erreur log' });
      return json(200, { ok: true, call_log: log, ...d });
    }

    // --- Supprimer une tentative -> statut recalculé ---
    if (body.action === 'log-delete') {
      const idx = Number(body.index);
      const cur = await supabaseGet(`webinaire_registrations?${where}&select=call_log`);
      if (!cur.ok || !Array.isArray(cur.data) || !cur.data.length) {
        return json(404, { error: 'Lead introuvable' });
      }
      const log = Array.isArray(cur.data[0].call_log) ? cur.data[0].call_log : [];
      if (Number.isInteger(idx) && idx >= 0 && idx < log.length) log.splice(idx, 1);

      const d = derive(log);
      const upd = await supabasePatch('webinaire_registrations', where, {
        call_log: log,
        call_count: log.length,
        call_status: d.call_status,
        next_callback_at: d.next_callback_at,
      });
      if (!upd.ok) return json(500, { error: 'Erreur suppression' });
      return json(200, { ok: true, call_log: log, ...d });
    }

    // --- Notes / transcript (auto-save) ---
    const patch = {};
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
