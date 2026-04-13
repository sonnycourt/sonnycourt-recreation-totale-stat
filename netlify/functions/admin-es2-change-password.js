import bcrypt from 'bcryptjs';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { fetchAdminAuthRow, savePasswordHash } from './lib/admin-es2-supabase.mjs';
import { checkRateLimit, recordFailure, clearRateLimit } from './lib/admin-es2-rate-limit.mjs';

const MIN_LEN = 12;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function validateTriple(current, next, confirm) {
  if (typeof current !== 'string' || typeof next !== 'string' || typeof confirm !== 'string') {
    return 'Données invalides.';
  }
  if (next.length < MIN_LEN) return `Nouveau mot de passe trop court (minimum ${MIN_LEN} caractères).`;
  if (next !== confirm) return 'Confirmation différente du nouveau mot de passe.';
  if (next === current) return 'Le nouveau mot de passe doit être différent de l’ancien.';
  return null;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    return json(401, { error: 'Non authentifié' });
  }

  const rl = await checkRateLimit(req);
  if (rl.blocked) {
    const h = new Headers([
      ['Content-Type', 'application/json'],
      ['Cache-Control', 'no-store'],
      ['Retry-After', String(rl.retryAfterSec || 900)],
    ]);
    return new Response(JSON.stringify({ error: 'Trop de tentatives. Réessaie plus tard.' }), { status: 429, headers: h });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'JSON invalide' });
  }

  const v = validateTriple(body.currentPassword, body.newPassword, body.confirm);
  if (v) {
    await recordFailure(req);
    return json(400, { error: v });
  }

  const rowRes = await fetchAdminAuthRow();
  if (!rowRes.ok || !rowRes.row || !rowRes.row.password_hash) {
    return json(500, { error: 'Configuration introuvable' });
  }

  const ok = await bcrypt.compare(body.currentPassword, rowRes.row.password_hash);
  if (!ok) {
    await recordFailure(req);
    return json(401, { error: 'Mot de passe actuel incorrect.' });
  }

  const hash = await bcrypt.hash(body.newPassword, 12);
  const saved = await savePasswordHash(hash);
  if (!saved.ok) {
    return json(500, { error: 'Mise à jour impossible' });
  }

  await clearRateLimit(req);
  return json(200, { ok: true });
};
