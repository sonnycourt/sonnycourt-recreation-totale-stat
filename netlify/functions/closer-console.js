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
  // Résultats actuels
  'Pas de réponse': null,
  'Répondeur': null,
  'Numéro invalide': 'Injoignable',
  'À rappeler': 'A rappeler',
  'En réflexion': 'En reflexion',
  'Dit oui (verbal)': 'Dit oui (verbal)',
  'Pas intéressé': 'Refuse',
  // Anciens libellés (compatibilité des appels déjà loggés)
  'Pas de reponse': null,
  Messagerie: null,
  Joint: 'En reflexion',
  'Rappel demande': 'A rappeler',
  'A dit OUI': 'Dit oui (verbal)',
  Refus: 'Refuse',
  'Faux numero': 'Injoignable',
  // Touches de la séquence multi-canal (W8+)
  'SMS rappelle-moi envoyé': null,
  'Vocal WhatsApp envoyé': null,
  'SMS deadline envoyé': null,
  'A répondu par écrit': 'En reflexion',
};

// Résultat signifiant "rappel à programmer" (nouveau libellé + ancien).
const CALLBACK_OUTCOMES = ['À rappeler', 'Rappel demande'];

// Touches passives (envois sans réponse) : elles s'enregistrent dans l'historique
// mais n'écrasent ni le statut ni le rappel planifié dérivés du dernier vrai échange.
const PASSIVE_OUTCOMES = ['SMS rappelle-moi envoyé', 'Vocal WhatsApp envoyé', 'SMS deadline envoyé'];

/** Statut + rappel dérivés de la dernière tentative significative. Historique vide -> à appeler. */
function derive(log) {
  if (!Array.isArray(log) || !log.length) return { call_status: null, next_callback_at: null };
  let last = null;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i] && !PASSIVE_OUTCOMES.includes(log[i].outcome)) { last = log[i]; break; }
  }
  if (!last) return { call_status: null, next_callback_at: null };
  const status = Object.prototype.hasOwnProperty.call(OUTCOME_STATUS, last.outcome)
    ? OUTCOME_STATUS[last.outcome]
    : null;
  const cb = CALLBACK_OUTCOMES.includes(last.outcome) && last.callback ? last.callback : null;
  return { call_status: status, next_callback_at: cb };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function authCloserId(req) {
  const secret = getCloserCookieSecret();
  if (!secret) return null;
  const data = verifyCloserToken(getCloserCookieValue(req.headers.get('cookie') || ''), secret);
  const cid = data && Number.isInteger(data.cid) ? data.cid : null;
  if (cid === null) return null;
  // Revérifie que le compte est toujours actif en base : un closer révoqué
  // (active=false) ne doit plus rien voir, même avec un cookie encore valide.
  const chk = await supabaseGet(`closer_access_codes?id=eq.${cid}&active=eq.true&select=id`);
  if (!chk.ok || !Array.isArray(chk.data) || !chk.data[0]) return null;
  return cid;
}

function dateISO(v) {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Liens d'affiliation Spiffy par formation : le checkout est le même pour tous
// les closers, seul l'identifiant affilié (fin d'URL) change (spiffy_affiliate_id).
const SPIFFY_CHECKOUTS = [
  ['Esprit Subconscient 2.0', 'Q0vnCdQy0VN', true], // formation principale, mise en avant
  ['Manifest', '2bnEhP4ZYkB'],
  ['Système Souhaits-Réalisés', '0DkQtNVKJvL'],
  ['Esprit Subconscient (1.0, pas ES2.0)', 'vpE4s0bJBlR'],
];

function affiliateLinks(affiliateId) {
  const aff = String(affiliateId || '').trim();
  if (!aff) return [];
  return SPIFFY_CHECKOUTS.map(([title, slug, featured]) => ({
    title,
    url: `https://sonnycourt.spiffy.co/a/${slug}/${aff}`,
    featured: !!featured,
  }));
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const cid = await authCloserId(req);
  if (cid === null) return json(401, { error: 'Non authentifié' });

  if (req.method === 'GET') {
    const r = await supabaseGet(
      `webinaire_registrations?assigned_closer_id=eq.${cid}` +
        '&select=token,prenom,telephone,email,pays,traffic_source,watch_max_minutes,saw_offer,visited_sales,checkout_clicked,purchased,purchased_at,' +
        'session_date,call_status,next_callback_at,call_notes,call_transcript,call_log,proposed_offers,rdv_at,rdv_booked_at,rdv_phone' +
        '&order=watch_max_minutes.desc',
    );
    if (!r.ok) return json(500, { error: 'Erreur lecture' });
    // Coordonnées du closer (téléphones + liens checkout) affichées en tête de console.
    let me = null;
    const meRes = await supabaseGet(
      `closer_access_codes?id=eq.${cid}&select=label,phone_1,phone_2,spiffy_affiliate_id`,
    );
    if (meRes.ok && Array.isArray(meRes.data) && meRes.data[0]) {
      me = meRes.data[0];
      me.affiliate_links = affiliateLinks(me.spiffy_affiliate_id);
      delete me.spiffy_affiliate_id;
    }
    return json(200, { leads: Array.isArray(r.data) ? r.data : [], me });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));

    // --- Le closer met à jour SON numéro (affiché aux prospects sur /rdv) ---
    if (body.action === 'set-phone') {
      const raw = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '';
      if (raw && !/^[+0-9 ().-]{6,30}$/.test(raw)) {
        return json(400, { error: 'Numéro invalide' });
      }
      const upd = await supabasePatch('closer_access_codes', `id=eq.${cid}`, {
        phone_1: raw || null,
      });
      if (!upd.ok) return json(500, { error: 'Erreur écriture' });
      return json(200, { ok: true, phone_1: raw || null });
    }

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
      if (CALLBACK_OUTCOMES.includes(outcome) && cb) entry.callback = cb;
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

    // --- Notes / transcript / formations proposées (auto-save) ---
    const patch = {};
    if (body.call_notes !== undefined) {
      patch.call_notes = body.call_notes ? String(body.call_notes).slice(0, 8000) : null;
    }
    if (body.call_transcript !== undefined) {
      patch.call_transcript = body.call_transcript ? String(body.call_transcript).slice(0, 8000) : null;
    }
    if (body.proposed_offers !== undefined) {
      const ALLOWED_OFFERS = ['es2', 'es2_5', 'manifest', 'ssr', 'es1', 'viral', 'challenge'];
      const offers = Array.isArray(body.proposed_offers)
        ? body.proposed_offers.filter((o) => ALLOWED_OFFERS.includes(o))
        : [];
      patch.proposed_offers = offers;
    }
    if (Object.keys(patch).length === 0) return json(400, { error: 'Rien à mettre à jour' });

    const upd = await supabasePatch('webinaire_registrations', where, patch);
    if (!upd.ok) return json(500, { error: 'Erreur écriture' });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Méthode non autorisée' });
};
