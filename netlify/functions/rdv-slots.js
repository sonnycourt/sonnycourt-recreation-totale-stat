import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';

/**
 * Page publique /rdv : le lead (identifié par son token d'inscription reçu par
 * SMS) réserve un créneau d'appel dans l'agenda de SON closer assigné.
 * Le RDV remonte dans la console du closer (rdv_at + next_callback_at).
 *
 * GET  ?t=token       : créneaux libres du closer assigné + RDV actuel éventuel.
 * POST { t, slot_id } : réserve le créneau (verrou atomique) ;
 *                       re-réservation = déplacement (l'ancien créneau se libère).
 */

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const REG_SELECT = 'id,token,prenom,telephone,purchased,assigned_closer_id,rdv_slot_id,rdv_at';

/** Identification par token (lien SMS personnalisé) OU email d'inscription (lien générique). */
async function getReg({ token, email }) {
  let where = '';
  if (token) where = `token=eq.${encodeURIComponent(token)}`;
  else if (email) where = `email=eq.${encodeURIComponent(email.trim().toLowerCase())}`;
  else return null;
  const r = await supabaseGet(`webinaire_registrations?${where}&select=${REG_SELECT}`);
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return null;
  return r.data[0];
}

/**
 * On ne renvoie jamais le téléphone complet (identification possible par simple
 * email) : uniquement les 2 derniers chiffres, pour que le lead reconnaisse son numéro.
 */
function phoneHint(tel) {
  const digits = String(tel || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-2) : '';
}

function firstName(label) {
  return String(label || '').trim().split(/\s+/)[0] || '';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const token = (url.searchParams.get('t') || url.searchParams.get('token') || '').trim();
    const email = (url.searchParams.get('email') || '').trim();
    if (!token && !email) return json(400, { error: 'Identifiant manquant' });

    const reg = await getReg({ token, email });
    if (!reg) {
      return json(404, { error: token ? 'Lien invalide' : "On ne trouve pas cet email. Utilise celui de ton inscription au webinaire." });
    }
    const base = { prenom: reg.prenom || '', phone_hint: phoneHint(reg.telephone) };
    if (reg.purchased) return json(200, { mode: 'purchased', ...base });
    if (!reg.assigned_closer_id) return json(200, { mode: 'no_closer', ...base });

    const cr = await supabaseGet(
      `closer_access_codes?id=eq.${reg.assigned_closer_id}&active=eq.true&select=label`,
    );
    const closerRow = cr.ok && Array.isArray(cr.data) && cr.data[0] ? cr.data[0] : null;
    if (!closerRow) return json(200, { mode: 'no_closer', ...base });

    // Petite marge : on ne propose pas un créneau qui démarre dans moins de 30 min.
    const minStart = new Date(Date.now() + 30 * 60000).toISOString();
    const sr = await supabaseGet(
      `closer_availability_slots?closer_id=eq.${reg.assigned_closer_id}` +
        `&booked_registration_id=is.null&slot_start=gte.${encodeURIComponent(minStart)}` +
        '&select=id,slot_start,slot_end&order=slot_start.asc',
    );
    if (!sr.ok) return json(500, { error: 'Erreur lecture' });

    const current = reg.rdv_at && new Date(reg.rdv_at).getTime() > Date.now() ? reg.rdv_at : null;
    return json(200, {
      mode: 'ok',
      ...base,
      closer: firstName(closerRow.label),
      slots: (Array.isArray(sr.data) ? sr.data : []).map((s) => ({
        id: s.id,
        start: s.slot_start,
        end: s.slot_end,
      })),
      current,
    });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const token = typeof body.t === 'string' ? body.t.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const slotId = Number(body.slot_id);
    if ((!token && !email) || !Number.isInteger(slotId) || slotId <= 0) {
      return json(400, { error: 'Requête invalide' });
    }
    const reg = await getReg({ token, email });
    if (!reg) return json(404, { error: 'Lien invalide' });
    if (reg.purchased) return json(400, { error: 'Tu fais déjà partie du programme' });
    if (!reg.assigned_closer_id) return json(400, { error: 'Aucun conseiller assigné' });

    const nowIso = new Date().toISOString();
    // Verrou atomique : le créneau doit appartenir à SON closer, être libre et à venir.
    const claim = await supabasePatch(
      'closer_availability_slots',
      `id=eq.${slotId}&closer_id=eq.${reg.assigned_closer_id}` +
        `&booked_registration_id=is.null&slot_start=gte.${encodeURIComponent(nowIso)}`,
      { booked_registration_id: reg.id, booked_at: nowIso },
    );
    if (!claim.ok) return json(500, { error: 'Erreur réservation' });
    if (!Array.isArray(claim.data) || !claim.data.length) {
      return json(409, { error: "Ce créneau vient d'être pris. Choisis-en un autre." });
    }
    const slot = claim.data[0];

    const upd = await supabasePatch(
      'webinaire_registrations',
      `token=eq.${encodeURIComponent(reg.token)}`,
      {
        rdv_slot_id: slotId,
        rdv_at: slot.slot_start,
        rdv_booked_at: nowIso,
        next_callback_at: slot.slot_start,
        call_status: 'A rappeler',
      },
    );
    if (!upd.ok) {
      // On libère le créneau pour ne pas bloquer l'agenda du closer.
      await supabasePatch(
        'closer_availability_slots',
        `id=eq.${slotId}&booked_registration_id=eq.${reg.id}`,
        { booked_registration_id: null, booked_at: null },
      ).catch(() => {});
      return json(500, { error: 'Erreur enregistrement' });
    }

    // Déplacement : on libère l'ancien créneau.
    if (reg.rdv_slot_id && reg.rdv_slot_id !== slotId) {
      await supabasePatch(
        'closer_availability_slots',
        `id=eq.${reg.rdv_slot_id}&booked_registration_id=eq.${reg.id}`,
        { booked_registration_id: null, booked_at: null },
      ).catch(() => {});
    }
    return json(200, { ok: true, at: slot.slot_start });
  }

  return json(405, { error: 'Méthode non autorisée' });
};
