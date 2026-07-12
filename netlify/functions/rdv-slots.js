import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';

/**
 * Page publique /rdv : réservation d'un appel avec son closer assigné.
 *
 * Flux principal (sans token) : le lead voit directement le calendrier
 * (créneaux libres agrégés de tous les closers actifs), choisit un créneau,
 * PUIS s'identifie (prénom + email + téléphone) dans une popup pour réserver.
 * Identification : email d'inscription d'abord, sinon téléphone (9 derniers
 * chiffres, via RPC find_webinaire_registration_by_phone). Aucun match ->
 * message rouge « utilise l'email de ton inscription à la masterclass ».
 * (Face aux prospects on dit toujours « masterclass », jamais « webinaire ».)
 *
 * GET  ?t=token / ?email=      : créneaux libres du closer assigné (flux SMS historique).
 * GET  (sans identifiant)      : mode 'open', créneaux agrégés anonymes.
 * POST { t|email, slot_id }    : réservation flux historique.
 * POST { prenom, email, telephone, start } : réservation flux calendrier-d'abord.
 */

const NOT_FOUND_MSG =
  "On ne trouve pas ton inscription. Utilise l'email avec lequel tu t'es inscrit(e) à la masterclass.";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const REG_SELECT =
  'id,token,prenom,telephone,purchased,assigned_closer_id,rdv_slot_id,rdv_at';

async function getRegByTokenOrEmail({ token, email }) {
  let where = '';
  if (token) where = `token=eq.${encodeURIComponent(token)}`;
  else if (email) where = `email=eq.${encodeURIComponent(email.trim().toLowerCase())}`;
  else return null;
  const r = await supabaseGet(`webinaire_registrations?${where}&select=${REG_SELECT}`);
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
  return r.data[0];
}

function normDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Email d'abord, sinon téléphone (9 derniers chiffres). */
async function findRegByIdentity({ email, telephone }) {
  if (email) {
    const byEmail = await getRegByTokenOrEmail({ email });
    if (byEmail) return byEmail;
  }
  const digits = normDigits(telephone);
  if (digits.length >= 8) {
    const r = await supabasePost('rpc/find_webinaire_registration_by_phone', {
      p_digits: digits,
    });
    if (r.ok && Array.isArray(r.data) && r.data[0]) {
      const row = r.data[0];
      return {
        id: row.id,
        token: row.token,
        prenom: row.prenom,
        telephone: row.telephone,
        purchased: row.purchased,
        assigned_closer_id: row.assigned_closer_id,
        rdv_slot_id: row.rdv_slot_id,
        rdv_at: row.rdv_at,
      };
    }
  }
  return null;
}

/** On ne renvoie jamais le téléphone complet : 2 derniers chiffres seulement. */
function phoneHint(tel) {
  const digits = normDigits(tel);
  return digits.length >= 4 ? digits.slice(-2) : '';
}

function firstName(label) {
  return String(label || '').trim().split(/\s+/)[0] || '';
}

/** Prénom + numéro (géré par le closer dans sa console) du closer actif. */
async function getActiveCloserInfo(closerId) {
  const cr = await supabaseGet(
    `closer_access_codes?id=eq.${closerId}&active=eq.true&select=label,phone_1`,
  );
  const row = cr.ok && Array.isArray(cr.data) && cr.data[0] ? cr.data[0] : null;
  if (!row) return null;
  return { name: firstName(row.label), phone: row.phone_1 || null };
}

async function getFreeSlots(closerId) {
  const minStart = new Date(Date.now() + 30 * 60000).toISOString();
  const sr = await supabaseGet(
    `closer_availability_slots?closer_id=eq.${closerId}` +
      `&booked_registration_id=is.null&slot_start=gte.${encodeURIComponent(minStart)}` +
      '&select=id,slot_start,slot_end&order=slot_start.asc',
  );
  if (!sr.ok) return null;
  return (Array.isArray(sr.data) ? sr.data : []).map((s) => ({
    id: s.id,
    start: s.slot_start,
    end: s.slot_end,
  }));
}

/** Créneaux libres agrégés de tous les closers actifs, dédoublonnés par heure. */
async function getOpenSlots() {
  const minStart = new Date(Date.now() + 30 * 60000).toISOString();
  const sr = await supabaseGet(
    'closer_availability_slots?select=slot_start,slot_end,closer_access_codes!inner(active)' +
      '&closer_access_codes.active=eq.true' +
      `&booked_registration_id=is.null&slot_start=gte.${encodeURIComponent(minStart)}` +
      '&order=slot_start.asc',
  );
  if (!sr.ok) return null;
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(sr.data) ? sr.data : []) {
    const k = new Date(s.slot_start).toISOString();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ start: s.slot_start, end: s.slot_end });
  }
  return out;
}

/**
 * Réserve un créneau (verrou atomique) et écrit le RDV sur l'inscription.
 * @returns {{status:number, body:object}}
 */
async function bookSlot(reg, slotWhere, extraPatch = {}) {
  const nowIso = new Date().toISOString();
  const claim = await supabasePatch(
    'closer_availability_slots',
    `${slotWhere}&closer_id=eq.${reg.assigned_closer_id}` +
      `&booked_registration_id=is.null&slot_start=gte.${encodeURIComponent(nowIso)}`,
    { booked_registration_id: reg.id, booked_at: nowIso },
  );
  if (!claim.ok) return { status: 500, body: { error: 'Erreur réservation' } };
  if (!Array.isArray(claim.data) || !claim.data.length) return null; // créneau pris
  const slot = claim.data[0];

  const upd = await supabasePatch(
    'webinaire_registrations',
    `token=eq.${encodeURIComponent(reg.token)}`,
    {
      rdv_slot_id: slot.id,
      rdv_at: slot.slot_start,
      rdv_booked_at: nowIso,
      next_callback_at: slot.slot_start,
      call_status: 'A rappeler',
      ...extraPatch,
    },
  );
  if (!upd.ok) {
    await supabasePatch(
      'closer_availability_slots',
      `id=eq.${slot.id}&booked_registration_id=eq.${reg.id}`,
      { booked_registration_id: null, booked_at: null },
    ).catch(() => {});
    return { status: 500, body: { error: 'Erreur enregistrement' } };
  }
  // Déplacement : on libère l'ancien créneau.
  if (reg.rdv_slot_id && reg.rdv_slot_id !== slot.id) {
    await supabasePatch(
      'closer_availability_slots',
      `id=eq.${reg.rdv_slot_id}&booked_registration_id=eq.${reg.id}`,
      { booked_registration_id: null, booked_at: null },
    ).catch(() => {});
  }
  return { status: 200, body: { ok: true, at: slot.slot_start } };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const token = (url.searchParams.get('t') || url.searchParams.get('token') || '').trim();
    const email = (url.searchParams.get('email') || '').trim();

    // --- Mode ouvert : calendrier anonyme, identification à la réservation ---
    if (!token && !email) {
      const slots = await getOpenSlots();
      if (!slots) return json(500, { error: 'Erreur lecture' });
      return json(200, { mode: 'open', slots });
    }

    // --- Flux historique (lien SMS avec token, ou email en query) ---
    const reg = await getRegByTokenOrEmail({ token, email });
    if (!reg) return json(404, { error: token ? 'Lien invalide' : NOT_FOUND_MSG });
    const base = { prenom: reg.prenom || '', phone_hint: phoneHint(reg.telephone) };
    if (reg.purchased) return json(200, { mode: 'purchased', ...base });
    if (!reg.assigned_closer_id) return json(200, { mode: 'no_closer', ...base });

    const closerInfo = await getActiveCloserInfo(reg.assigned_closer_id);
    if (!closerInfo) return json(200, { mode: 'no_closer', ...base });

    const slots = await getFreeSlots(reg.assigned_closer_id);
    if (!slots) return json(500, { error: 'Erreur lecture' });
    const current = reg.rdv_at && new Date(reg.rdv_at).getTime() > Date.now() ? reg.rdv_at : null;
    return json(200, { mode: 'ok', ...base, closer: closerInfo.name, closer_phone: closerInfo.phone, slots, current });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));

    // --- Flux calendrier-d'abord : identification dans la popup ---
    if (body.start !== undefined) {
      const prenom = typeof body.prenom === 'string' ? body.prenom.trim().slice(0, 60) : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const telephone = typeof body.telephone === 'string' ? body.telephone.trim().slice(0, 30) : '';
      const start = new Date(body.start);
      if (Number.isNaN(start.getTime()) || (!email && !telephone)) {
        return json(400, { error: 'Requête invalide' });
      }

      const reg = await findRegByIdentity({ email, telephone });
      if (!reg) return json(404, { error: NOT_FOUND_MSG, code: 'not_found' });
      if (reg.purchased) return json(200, { mode: 'purchased', prenom: reg.prenom || prenom });
      if (!reg.assigned_closer_id) return json(200, { mode: 'no_closer', prenom: reg.prenom || prenom });
      const closerInfo = await getActiveCloserInfo(reg.assigned_closer_id);
      if (!closerInfo) return json(200, { mode: 'no_closer', prenom: reg.prenom || prenom });
      const closer = closerInfo.name;

      // Le numéro saisi = numéro à appeler pour le RDV ; prénom complété s'il manquait.
      const extra = {};
      if (telephone) extra.rdv_phone = telephone;
      if (prenom && !reg.prenom) extra.prenom = prenom;

      const startIso = start.toISOString();
      const booked = await bookSlot(
        reg,
        `slot_start=eq.${encodeURIComponent(startIso)}`,
        extra,
      );
      if (booked) {
        if (booked.status !== 200) return json(booked.status, booked.body);
        return json(200, {
          ...booked.body,
          closer,
          closer_phone: closerInfo.phone,
          prenom: reg.prenom || prenom,
          phone_hint: phoneHint(telephone || reg.telephone),
        });
      }
      // Créneau plus dispo pour SON closer -> on renvoie ses vrais créneaux.
      const slots = await getFreeSlots(reg.assigned_closer_id);
      return json(409, {
        error: `Ce créneau n'est plus disponible pour ton coach ${closer}. Choisis parmi ses créneaux ci-dessous.`,
        code: 'slot_taken',
        closer,
        closer_phone: closerInfo.phone,
        slots: slots || [],
      });
    }

    // --- Flux historique : token/email + slot_id ---
    const token = typeof body.t === 'string' ? body.t.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const slotId = Number(body.slot_id);
    if ((!token && !email) || !Number.isInteger(slotId) || slotId <= 0) {
      return json(400, { error: 'Requête invalide' });
    }
    const reg = await getRegByTokenOrEmail({ token, email });
    if (!reg) return json(404, { error: 'Lien invalide' });
    if (reg.purchased) return json(400, { error: 'Tu fais déjà partie du programme' });
    if (!reg.assigned_closer_id) return json(400, { error: 'Aucun coach assigné' });

    const booked = await bookSlot(reg, `id=eq.${slotId}`);
    if (!booked) return json(409, { error: "Ce créneau vient d'être pris. Choisis-en un autre." });
    return json(booked.status, booked.body);
  }

  return json(405, { error: 'Méthode non autorisée' });
};
