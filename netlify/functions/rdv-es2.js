import { getStore } from '@netlify/blobs';
import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';

/**
 * Page /rdv-es2 : réservation d'appel QUALIFIÉE (blast WhatsApp du groupe).
 * Fonction dédiée, isolée de rdv-slots.js (flux SMS) — ne touche pas l'existant.
 *
 * Entonnoir : identification (token masterclass ou email/téléphone) →
 *   1) filtre visionnage : doit avoir vu l'offre du webinaire (saw_offer,
 *      posé à 89min26 par le player, ou ≥ 90 min de visionnage en secours) ;
 *      sinon → mode 'replay' (regarder le replay d'abord).
 *   2) filtre budget : capacité d'investissement déclarée (rdv_budget_declared).
 *      '<200' → redirection /manifest-presentation (downsell self-service).
 *   3) calendrier : lead déjà assigné → créneaux de SON closer uniquement ;
 *      lead non assigné → créneaux fusionnés, et le closer propriétaire du
 *      créneau réservé devient son closer assigné (attribution automatique,
 *      départage par nombre de RDV à venir le plus faible).
 *
 * POST { action:'identify', t?|email?|telephone? }
 * POST { action:'budget',   t?|email?|telephone?, budget }
 * POST { action:'book',     t?|email?|telephone?, start, telephone? }
 */

const NOT_FOUND_MSG =
  "On ne trouve pas ton inscription. Utilise l'email avec lequel tu t'es inscrit(e) à la masterclass.";

const BUDGET_VALUES = ['500+', '200-500', '<200'];
const BUDGET_OK = ['500+', '200-500'];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const REG_SELECT =
  'id,token,prenom,telephone,purchased,assigned_closer_id,rdv_slot_id,rdv_at,' +
  'saw_offer,watch_max_minutes';

// Budget déclaré : Netlify Blobs (pas de colonne en base). Un blob par token
// (source de vérité, écrit atomiquement) + un index agrégé { token: budget }
// lu d'un coup par la console closers.
function budgetStore() {
  return getStore('rdv-es2-budgets');
}

async function getBudget(token) {
  try {
    const raw = await budgetStore().get(`token/${token}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return BUDGET_VALUES.includes(data.budget) ? data.budget : null;
  } catch {
    return null;
  }
}

async function setBudget(token, budget) {
  const store = budgetStore();
  await store.set(
    `token/${token}`,
    JSON.stringify({ budget, at: new Date().toISOString() }),
  );
  // Index agrégé pour la console (meilleur effort : le blob individuel fait foi).
  try {
    const raw = await store.get('index');
    const map = raw ? JSON.parse(raw) : {};
    map[token] = budget;
    await store.set('index', JSON.stringify(map));
  } catch {
    /* noop */
  }
}

/** A vu l'offre du webinaire (flag player) — secours : ≥ 90 min de visionnage. */
function isEligible(reg) {
  return reg.saw_offer === true || Number(reg.watch_max_minutes || 0) >= 90;
}

function normDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Token d'abord, puis email, puis téléphone (9 derniers chiffres). */
async function findReg({ token, email, telephone }) {
  if (token) {
    const r = await supabaseGet(
      `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=${REG_SELECT}`,
    );
    if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0];
  }
  if (email) {
    const r = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=${REG_SELECT}`,
    );
    if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0];
  }
  const digits = normDigits(telephone);
  if (digits.length >= 8) {
    const r = await supabasePost('rpc/find_webinaire_registration_by_phone', {
      p_digits: digits,
    });
    if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0];
  }
  return null;
}

/** Signal closer : le lead a ouvert la page RDV (n'écrase pas une visite déjà posée). */
async function stampRdvVisit(token) {
  if (!token) return;
  try {
    await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(token)}&rdv_page_visited_at=is.null`,
      { rdv_page_visited_at: new Date().toISOString() },
    );
  } catch (e) {
    /* noop */
  }
}

function phoneHint(tel) {
  const digits = normDigits(tel);
  return digits.length >= 4 ? digits.slice(-2) : '';
}

function firstName(label) {
  return String(label || '').trim().split(/\s+/)[0] || '';
}

async function getActiveCloserInfo(closerId) {
  const cr = await supabaseGet(
    `closer_access_codes?id=eq.${closerId}&active=eq.true&select=id,label,phone_1`,
  );
  const row = cr.ok && Array.isArray(cr.data) && cr.data[0] ? cr.data[0] : null;
  if (!row) return null;
  return { id: row.id, name: firstName(row.label), phone: row.phone_1 || null };
}

async function getFreeSlots(closerId) {
  const minStart = new Date(Date.now() + 30 * 60000).toISOString();
  const sr = await supabaseGet(
    `closer_availability_slots?closer_id=eq.${closerId}` +
      `&booked_registration_id=is.null&slot_start=gte.${encodeURIComponent(minStart)}` +
      '&select=slot_start,slot_end&order=slot_start.asc',
  );
  if (!sr.ok) return null;
  return (Array.isArray(sr.data) ? sr.data : []).map((s) => ({
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

/** Payload calendrier selon l'assignation du lead. */
async function buildCalendar(reg) {
  const current =
    reg.rdv_at && new Date(reg.rdv_at).getTime() > Date.now() ? reg.rdv_at : null;
  if (reg.assigned_closer_id) {
    const closerInfo = await getActiveCloserInfo(reg.assigned_closer_id);
    if (closerInfo) {
      const slots = await getFreeSlots(closerInfo.id);
      if (!slots) return null;
      return {
        assigned: true,
        closer: closerInfo.name,
        closer_phone: closerInfo.phone,
        slots,
        current,
      };
    }
  }
  const slots = await getOpenSlots();
  if (!slots) return null;
  return { assigned: false, slots, current };
}

/** Nombre de RDV à venir d'un closer (départage de l'attribution automatique). */
async function countUpcomingBooked(closerId) {
  const nowIso = new Date().toISOString();
  const r = await supabaseGet(
    `closer_availability_slots?closer_id=eq.${closerId}` +
      `&booked_registration_id=not.is.null&slot_start=gte.${encodeURIComponent(nowIso)}&select=id`,
  );
  return r.ok && Array.isArray(r.data) ? r.data.length : 0;
}

/**
 * Réserve le créneau d'un closer précis (verrou atomique) et écrit le RDV
 * + l'attribution sur l'inscription. null si le créneau vient d'être pris.
 */
async function bookSlotForCloser(reg, closerId, startIso, extraPatch = {}) {
  const nowIso = new Date().toISOString();
  const claim = await supabasePatch(
    'closer_availability_slots',
    `slot_start=eq.${encodeURIComponent(startIso)}&closer_id=eq.${closerId}` +
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
      assigned_closer_id: closerId,
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

/** Closers actifs ayant un créneau libre à cette heure, le moins chargé d'abord. */
async function candidatesForStart(startIso) {
  const sr = await supabaseGet(
    `closer_availability_slots?slot_start=eq.${encodeURIComponent(startIso)}` +
      '&booked_registration_id=is.null' +
      '&select=closer_id,closer_access_codes!inner(active)' +
      '&closer_access_codes.active=eq.true',
  );
  if (!sr.ok || !Array.isArray(sr.data)) return [];
  const ids = [...new Set(sr.data.map((s) => s.closer_id))];
  const withLoad = await Promise.all(
    ids.map(async (id) => ({ id, load: await countUpcomingBooked(id) })),
  );
  withLoad.sort((a, b) => a.load - b.load);
  return withLoad.map((c) => c.id);
}

function identityFromBody(body) {
  return {
    token: typeof body.t === 'string' ? body.t.trim() : '',
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
    telephone: typeof body.telephone === 'string' ? body.telephone.trim().slice(0, 30) : '',
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === 'string' ? body.action : '';
  const ident = identityFromBody(body);

  if (!ident.token && !ident.email && !ident.telephone) {
    return json(400, { error: 'Identifiant requis' });
  }

  const reg = await findReg(ident);
  if (!reg) return json(404, { error: NOT_FOUND_MSG, code: 'not_found' });

  const base = { prenom: reg.prenom || '', token: reg.token };

  // ---------- identify : point d'entrée du funnel ----------
  if (action === 'identify') {
    await stampRdvVisit(reg.token);
    if (reg.purchased) return json(200, { mode: 'purchased', ...base });
    if (!isEligible(reg)) {
      return json(200, {
        mode: 'replay',
        ...base,
        replay_url: `/masterclass/replay?t=${encodeURIComponent(reg.token)}`,
      });
    }
    const [calendar, declaredBudget] = await Promise.all([
      buildCalendar(reg),
      getBudget(reg.token),
    ]);
    if (!calendar) return json(500, { error: 'Erreur lecture' });
    return json(200, {
      mode: 'ok',
      ...base,
      phone_hint: phoneHint(reg.telephone),
      phone_known: !!reg.telephone,
      budget: declaredBudget,
      need_budget: !BUDGET_OK.includes(declaredBudget),
      ...calendar,
    });
  }

  // ---------- budget : capacité d'investissement déclarée ----------
  if (action === 'budget') {
    const budget = typeof body.budget === 'string' ? body.budget.trim() : '';
    if (!BUDGET_VALUES.includes(budget)) return json(400, { error: 'Budget invalide' });
    try {
      await setBudget(reg.token, budget);
    } catch (e) {
      return json(500, { error: 'Erreur enregistrement' });
    }
    if (budget === '<200') {
      return json(200, {
        ok: true,
        redirect: `/manifest-presentation/?t=${encodeURIComponent(reg.token)}`,
      });
    }
    return json(200, { ok: true });
  }

  // ---------- book : réservation + attribution ----------
  if (action === 'book') {
    if (reg.purchased) return json(200, { mode: 'purchased', ...base });
    if (!isEligible(reg)) {
      return json(200, {
        mode: 'replay',
        ...base,
        replay_url: `/masterclass/replay?t=${encodeURIComponent(reg.token)}`,
      });
    }
    const declaredBudget = await getBudget(reg.token);
    if (!BUDGET_OK.includes(declaredBudget)) {
      return json(400, { error: 'Réponds d’abord à la question budget.', code: 'budget_required' });
    }
    const start = new Date(body.start);
    if (Number.isNaN(start.getTime())) return json(400, { error: 'Requête invalide' });
    if (!reg.telephone && !ident.telephone) {
      return json(400, {
        code: 'phone_required',
        error: "Il nous manque ton numéro pour que ton coach puisse t'appeler.",
      });
    }

    const extra = {};
    if (ident.telephone) extra.rdv_phone = ident.telephone;
    const startIso = start.toISOString();

    // Lead assigné (closer actif) → son closer uniquement ; sinon attribution auto.
    let closerIds = [];
    let assignedInfo = null;
    if (reg.assigned_closer_id) {
      assignedInfo = await getActiveCloserInfo(reg.assigned_closer_id);
      if (assignedInfo) closerIds = [assignedInfo.id];
    }
    if (!closerIds.length) closerIds = await candidatesForStart(startIso);

    for (const closerId of closerIds) {
      const booked = await bookSlotForCloser(reg, closerId, startIso, extra);
      if (!booked) continue; // créneau de CE closer pris → candidat suivant
      if (booked.status !== 200) return json(booked.status, booked.body);
      const closerInfo =
        assignedInfo && assignedInfo.id === closerId
          ? assignedInfo
          : await getActiveCloserInfo(closerId);
      return json(200, {
        ...booked.body,
        ...base,
        closer: closerInfo ? closerInfo.name : '',
        closer_phone: closerInfo ? closerInfo.phone : null,
        phone_hint: phoneHint(ident.telephone || reg.telephone),
      });
    }

    // Plus personne de libre à cette heure → calendrier à jour.
    const calendar = await buildCalendar(reg);
    return json(409, {
      error: "Ce créneau vient d'être pris. Choisis-en un autre ci-dessous.",
      code: 'slot_taken',
      ...base,
      ...(calendar || { slots: [] }),
    });
  }

  return json(400, { error: 'Action inconnue' });
};
