// POST /api/oracle-es2-generate
// Body : { password, question }
// Cherche les réponses passées les plus proches, génère un brouillon dans le style perso.
// Protégé par mot de passe. N'envoie rien à personne : retourne juste le brouillon.

import { checkPassword, embedQuestion, generateDraft } from './lib/oracle-es2-shared.mjs';
import { supabasePost } from './lib/supabase-rest.mjs';
import { clientIpFromEvent, checkRateLimit, recordFailure, clearRateLimit } from './lib/oracle-es2-rate-limit.mjs';

const MATCH_COUNT = 5;

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
  if (!question) {
    return json(400, { error: 'La question est obligatoire' });
  }

  try {
    const embedding = await embedQuestion(question);
    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      return json(502, { error: 'Embedding invalide' });
    }

    // Recherche sémantique (fonction SQL match_oracle_es2)
    const match = await supabasePost('rpc/match_oracle_es2', {
      query_embedding: JSON.stringify(embedding),
      match_count: MATCH_COUNT,
    });

    if (!match.ok) {
      console.error('❌ oracle-es2-generate match:', match.error);
      return json(502, { error: 'Échec recherche Supabase' });
    }

    const examples = Array.isArray(match.data) ? match.data : [];

    const draft = await generateDraft({ question, examples });

    return json(200, {
      ok: true,
      draft,
      used: examples.map((e) => ({
        question: e.question,
        similarity: typeof e.similarity === 'number' ? Math.round(e.similarity * 1000) / 1000 : null,
      })),
    });
  } catch (err) {
    console.error('❌ oracle-es2-generate:', err);
    return json(500, { error: err.message || 'Erreur interne' });
  }
};
