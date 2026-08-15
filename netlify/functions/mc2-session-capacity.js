import { supabasePost } from './lib/supabase-rest.mjs';

const DEFAULT_CAPACITY = 3;
const DEFAULT_HOLD_MINUTES = 15;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function cleanToken(value) {
  return typeof value === 'string' ? value.trim().slice(0, 128) : '';
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function enabled() {
  return String(process.env.MC2_SESSION_SCARCITY_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function publicRow(row = {}) {
  return {
    enabled: true,
    capacity: boundedInt(row.capacity, DEFAULT_CAPACITY, 1, 20),
    occupied: boundedInt(row.occupied, 0, 0, 20),
    remaining: boundedInt(row.remaining, 0, 0, 20),
    reserved: row.reserved === true,
    reserved_until: row.reserved_until || null,
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'Méthode non autorisée' });
  if (!enabled()) return json(200, { ok: true, enabled: false });

  const capacity = boundedInt(process.env.MC2_SESSION_CAPACITY, DEFAULT_CAPACITY, 1, 20);
  const holdMinutes = boundedInt(process.env.MC2_SESSION_SEAT_HOLD_MINUTES, DEFAULT_HOLD_MINUTES, 5, 60);
  let token = '';
  if (req.method === 'GET') {
    token = cleanToken(new URL(req.url).searchParams.get('t'));
  } else {
    const body = await req.json().catch(() => ({}));
    token = cleanToken(body.token);
  }
  if (!token) return json(400, { error: 'Token manquant' });

  const rpc = req.method === 'POST' ? 'rpc/mc2_reserve_session_seat_v1' : 'rpc/mc2_session_capacity_v1';
  const payload = req.method === 'POST'
    ? { p_token: token, p_capacity: capacity, p_hold_minutes: holdMinutes }
    : { p_token: token, p_capacity: capacity };
  const result = await supabasePost(rpc, payload);

  // Garde-fou de déploiement : tant que la migration SQL n'est pas présente,
  // la rareté reste invisible et le paiement existant continue normalement.
  if (!result.ok) {
    console.error('mc2-session-capacity unavailable:', result.status, result.error);
    return json(200, { ok: true, enabled: false, reason: 'capacity_unavailable' });
  }

  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return json(404, { error: 'Inscription MC2 introuvable' });

  if (req.method === 'POST') {
    const response = {
      ...publicRow(row),
      accepted: row.accepted === true,
      reason: String(row.reason || ''),
    };
    if (!response.accepted && response.reason === 'session_full') {
      return json(409, { ...response, error: 'Cette session est complète.' });
    }
    if (!response.accepted && response.reason === 'offer_expired') {
      return json(410, { ...response, error: 'Cette offre a expiré.' });
    }
    if (!response.accepted) return json(409, { ...response, error: 'La place ne peut pas être réservée.' });
    return json(200, { ok: true, ...response });
  }

  return json(200, { ok: true, ...publicRow(row) });
};
