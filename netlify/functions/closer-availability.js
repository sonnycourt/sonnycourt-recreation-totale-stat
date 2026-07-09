import { supabaseGet, supabasePost, supabaseDelete } from './lib/supabase-rest.mjs';
import {
  getCloserCookieSecret,
  getCloserCookieValue,
  verifyCloserToken,
} from './lib/closer-access-crypto.mjs';
import { getWeekendSlotGrid } from './lib/rdv-weekend.mjs';

/**
 * Disponibilités du closer connecté (onglet "Mes disponibilités" de la console).
 * La grille est celle du week-end d'appels courant (ven 16h → dim 21h Paris).
 *
 * GET  : grille + état de chaque créneau (off = fermé, open = ouvert,
 *        booked = réservé par un lead, avec prénom + téléphone du lead).
 * POST { start, on } : ouvre/ferme un créneau. Un créneau réservé ne se ferme pas.
 */

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
  const chk = await supabaseGet(`closer_access_codes?id=eq.${cid}&active=eq.true&select=id`);
  if (!chk.ok || !Array.isArray(chk.data) || !chk.data[0]) return null;
  return cid;
}

function normIso(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  const cid = await authCloserId(req);
  if (cid === null) return json(401, { error: 'Non authentifié' });

  const grid = getWeekendSlotGrid(new Date());
  if (!grid) return json(500, { error: 'Week-end introuvable' });
  const firstStart = grid.days[0].slots[0].start;
  const lastDay = grid.days[grid.days.length - 1];
  const lastEnd = lastDay.slots[lastDay.slots.length - 1].end;

  if (req.method === 'GET') {
    const r = await supabaseGet(
      `closer_availability_slots?closer_id=eq.${cid}` +
        `&slot_start=gte.${encodeURIComponent(firstStart)}&slot_start=lt.${encodeURIComponent(lastEnd)}` +
        '&select=id,slot_start,booked_registration_id',
    );
    if (!r.ok) return json(500, { error: 'Erreur lecture' });
    const mine = {};
    (Array.isArray(r.data) ? r.data : []).forEach((row) => {
      const k = normIso(row.slot_start);
      if (k) mine[k] = row;
    });

    // Prénom + téléphone des leads ayant réservé.
    const regIds = Object.values(mine)
      .map((m) => m.booked_registration_id)
      .filter(Boolean);
    const leads = {};
    if (regIds.length) {
      const lr = await supabaseGet(
        `webinaire_registrations?id=in.(${regIds.join(',')})&select=id,prenom,telephone`,
      );
      if (lr.ok && Array.isArray(lr.data)) lr.data.forEach((l) => { leads[l.id] = l; });
    }

    const days = grid.days.map((d) => ({
      key: d.key,
      title: d.title,
      slots: d.slots.map((s) => {
        const m = mine[s.start];
        if (!m) return { start: s.start, label: s.label, state: 'off' };
        if (m.booked_registration_id) {
          const l = leads[m.booked_registration_id] || {};
          return {
            start: s.start,
            label: s.label,
            state: 'booked',
            lead: { prenom: l.prenom || 'Lead', telephone: l.telephone || '' },
          };
        }
        return { start: s.start, label: s.label, state: 'open' };
      }),
    }));
    return json(200, { ok: true, deadline: grid.deadline, days });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const start = normIso(body.start);
    const on = body.on === true;
    const cand = grid.days.flatMap((d) => d.slots).find((s) => s.start === start);
    if (!cand) return json(400, { error: 'Créneau invalide' });

    if (on) {
      const ins = await supabasePost('closer_availability_slots', {
        closer_id: cid,
        slot_start: cand.start,
        slot_end: cand.end,
      });
      // 409 = déjà ouvert (contrainte unique) -> état voulu atteint.
      if (!ins.ok && ins.status !== 409) return json(500, { error: 'Erreur écriture' });
      return json(200, { ok: true, state: 'open' });
    }

    const del = await supabaseDelete(
      'closer_availability_slots',
      `closer_id=eq.${cid}&slot_start=eq.${encodeURIComponent(cand.start)}&booked_registration_id=is.null`,
    );
    if (!del.ok) return json(500, { error: 'Erreur écriture' });
    if (!Array.isArray(del.data) || !del.data.length) {
      // Rien supprimé : soit déjà fermé, soit réservé entre-temps par un lead.
      const chk = await supabaseGet(
        `closer_availability_slots?closer_id=eq.${cid}&slot_start=eq.${encodeURIComponent(cand.start)}&select=id,booked_registration_id`,
      );
      const row = chk.ok && Array.isArray(chk.data) ? chk.data[0] : null;
      if (row && row.booked_registration_id) {
        return json(409, { error: 'Créneau déjà réservé par un lead', state: 'booked' });
      }
    }
    return json(200, { ok: true, state: 'off' });
  }

  return json(405, { error: 'Méthode non autorisée' });
};
