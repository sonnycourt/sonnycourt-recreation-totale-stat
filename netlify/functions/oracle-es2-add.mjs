// POST /api/oracle-es2-add
// Body : { password, question, reponse, raisonnement? }
// Stocke la paire + l'embedding de la question. Protégé par mot de passe.

import { checkPassword, embedQuestion } from './lib/oracle-es2-shared.mjs';
import { supabasePost, supabaseGet } from './lib/supabase-rest.mjs';
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

  const question = (payload.question || '').trim();
  const reponse = (payload.reponse || '').trim();
  const raisonnement = (payload.raisonnement || '').trim();

  if (!question || !reponse) {
    return json(400, { error: 'La question et la réponse sont obligatoires' });
  }

  try {
    const embedding = await embedQuestion(question);
    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      return json(502, { error: 'Embedding invalide' });
    }

    const insert = await supabasePost('oracle_es2_entries', {
      question,
      reponse,
      raisonnement: raisonnement || null,
      // pgvector via PostgREST : le vecteur se passe en chaîne "[...]"
      embedding: JSON.stringify(embedding),
    });

    if (!insert.ok) {
      console.error('❌ oracle-es2-add insert:', insert.error);
      return json(502, { error: 'Échec enregistrement Supabase' });
    }

    // Total en base (scan léger, suffisant à cette échelle)
    const count = await supabaseGet('oracle_es2_entries?select=id');
    const total = Array.isArray(count.data) ? count.data.length : null;

    return json(200, { ok: true, total });
  } catch (err) {
    console.error('❌ oracle-es2-add:', err);
    return json(500, { error: err.message || 'Erreur interne' });
  }
};
