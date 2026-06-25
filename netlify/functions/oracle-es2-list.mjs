// POST /api/oracle-es2-list
// Body : { password }
// Retourne la liste des paires enregistrées (sans l'embedding), récentes d'abord.
// Protégé par mot de passe + rate-limit, comme les autres endpoints oracle.

import { checkPassword } from './lib/oracle-es2-shared.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';
import { clientIpFromEvent, checkRateLimit, recordFailure, clearRateLimit } from './lib/oracle-es2-rate-limit.mjs';

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...extraHeaders },
  body: JSON.stringify(body),
});

const tooMany = (retryAfterSec) =>
  json(429, { error: 'Trop de tentatives. Réessaie dans quelques minutes.' }, { 'Retry-After': String(retryAfterSec || 900) });

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'JSON invalide' });
  }

  const ip = clientIpFromEvent(event);
  const rl = await checkRateLimit(ip);
  if (rl.blocked) return tooMany(rl.retryAfterSec);

  const pw = checkPassword(payload.password);
  if (!pw.ok) {
    if (pw.reason === 'config') return json(500, { error: 'Configuration serveur manquante' });
    const rf = await recordFailure(ip);
    if (rf.blocked) return tooMany(rf.retryAfterSec);
    return json(401, { error: 'Mot de passe invalide' });
  }
  await clearRateLimit(ip);

  try {
    const res = await supabaseGet(
      'oracle_es2_entries?select=id,question,reponse,raisonnement,created_at&order=created_at.desc'
    );
    if (!res.ok) {
      console.error('❌ oracle-es2-list:', res.error);
      return json(502, { error: 'Échec lecture Supabase' });
    }
    const entries = Array.isArray(res.data) ? res.data : [];
    return json(200, { ok: true, total: entries.length, entries });
  } catch (err) {
    console.error('❌ oracle-es2-list:', err);
    return json(500, { error: err.message || 'Erreur interne' });
  }
};
