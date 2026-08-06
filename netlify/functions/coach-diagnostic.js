import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';
import { loadCoachingCoachContact } from './lib/coaching-contacts.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function releaseExpiredHolds() {
  const now = new Date().toISOString();
  await Promise.all([
    supabasePatch(
      'coach_diagnostic_bookings',
      'status=eq.pending_payment&expires_at=lt.' + encodeURIComponent(now),
      { status: 'expired' },
    ),
    supabasePatch(
      'coach_diagnostic_slots',
      'status=eq.held&held_until=lt.' + encodeURIComponent(now),
      { status: 'available', held_until: null },
    ),
    supabasePatch(
      'coaching_availability_slots',
      'status=eq.held&held_until=lt.' + encodeURIComponent(now),
      { status: 'available', held_until: null },
    ),
  ]).catch(() => {});
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const bookingToken = clean(url.searchParams.get('booking'), 80);

    if (bookingToken) {
      const result = await supabaseGet(
        'coach_diagnostic_bookings?public_token=eq.' + encodeURIComponent(bookingToken) +
        '&select=status,expires_at,customer_name,customer_email,coach_diagnostic_slots(starts_at,ends_at)&limit=1',
      );
      const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
      if (!row) return json(404, { error: 'Réservation introuvable' });
      const slot = row.coach_diagnostic_slots || {};
      const clientResult = await supabaseGet(
        'coaching_clients?email=eq.' + encodeURIComponent(row.customer_email) + '&select=auth_user_id&limit=1',
      );
      const client = clientResult.ok && Array.isArray(clientResult.data) ? clientResult.data[0] : null;
      const coachContact = row.status === 'paid'
        ? await loadCoachingCoachContact('romain').catch(() => null)
        : null;
      return json(200, {
        status: row.status,
        expires_at: row.expires_at,
        start: slot.starts_at || null,
        end: slot.ends_at || null,
        name: row.customer_name,
        email: row.customer_email,
        account_active: Boolean(client?.auth_user_id),
        coach_phone: coachContact?.phone || null,
        coach_whatsapp_url: coachContact?.whatsapp_url || null,
      });
    }

    await releaseExpiredHolds();
    const minStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const result = await supabaseGet(
      'coach_diagnostic_slots?coach_slug=eq.romain&status=eq.available' +
      '&starts_at=gte.' + encodeURIComponent(minStart) +
      '&select=id,starts_at,ends_at&order=starts_at.asc&limit=96',
    );
    if (!result.ok) return json(500, { error: 'Impossible de lire les disponibilités' });
    let slots = Array.isArray(result.data) ? result.data : [];
    if (slots.length) {
      const coachResult = await supabaseGet('coaching_coaches?slug=eq.romain&status=eq.active&select=id&limit=1');
      const coach = coachResult.ok && Array.isArray(coachResult.data) ? coachResult.data[0] : null;
      if (coach?.id) {
        const maxEnd = slots.reduce((latest, slot) => Math.max(latest, new Date(slot.ends_at).getTime()), 0);
        const atomsResult = await supabaseGet(
          `coaching_availability_slots?coach_id=eq.${coach.id}&status=eq.available` +
          '&starts_at=gte.' + encodeURIComponent(slots[0].starts_at) +
          '&starts_at=lt.' + encodeURIComponent(new Date(maxEnd).toISOString()) +
          '&select=starts_at,ends_at&order=starts_at.asc',
        );
        const atoms = atomsResult.ok && Array.isArray(atomsResult.data) ? atomsResult.data : [];
        if (atoms.length) {
          const atomicStarts = new Set(atoms
            .filter((atom) => new Date(atom.ends_at).getTime() - new Date(atom.starts_at).getTime() === 15 * 60000)
            .map((atom) => new Date(atom.starts_at).toISOString()));
          slots = slots.filter((slot) => {
            const start = new Date(slot.starts_at).getTime();
            return [0, 15, 30].every((offset) => atomicStarts.has(new Date(start + offset * 60000).toISOString()));
          });
        }
      }
    }
    return json(200, {
      slots: slots.slice(0, 24).map((slot) => ({
        id: slot.id,
        start: slot.starts_at,
        end: slot.ends_at,
      })),
    });
  }

  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => ({}));
    const bookingToken = clean(body.booking, 80);
    const focus = clean(body.focus, 40);
    const note = clean(body.note, 800);

    if (!bookingToken || !focus) {
      return json(400, { error: 'Choisis le sujet principal de la consultation.' });
    }

    const updated = await supabasePatch(
      'coach_diagnostic_bookings',
      'public_token=eq.' + encodeURIComponent(bookingToken) + '&status=eq.paid',
      { focus, note: note || null },
    );
    const row = updated.ok && Array.isArray(updated.data) ? updated.data[0] : null;
    if (!updated.ok) return json(500, { error: 'Impossible d’enregistrer ta préparation.' });
    if (!row) return json(404, { error: 'Consultation confirmée introuvable.' });
    return json(200, { ok: true });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const slotId = Number(body.slot_id);
    const name = clean(body.name, 60);
    const email = clean(body.email, 254).toLowerCase();

    if (!Number.isInteger(slotId) || slotId <= 0 || !name || !validEmail(email)) {
      return json(400, { error: 'Vérifie les informations renseignées.' });
    }

    const held = await supabasePost('rpc/hold_coach_diagnostic_slot', {
      p_slot_id: slotId,
      p_name: name,
      p_email: email,
    });

    if (!held.ok) {
      const unavailable = String(held.error || '').includes('slot_unavailable');
      return json(unavailable ? 409 : 500, {
        error: unavailable
          ? 'Ce créneau vient d’être pris. Choisis-en un autre.'
          : 'Impossible de réserver ce créneau pour le moment.',
      });
    }

    const row = Array.isArray(held.data) ? held.data[0] : held.data;
    if (!row?.booking_token) return json(500, { error: 'Réservation incomplète' });

    return json(200, {
      booking: row.booking_token,
      expires_at: row.expires_at,
      payment_url: '/coach-romain/paiement?booking=' + encodeURIComponent(row.booking_token),
    });
  }

  return json(405, { error: 'Méthode non autorisée' });
};
