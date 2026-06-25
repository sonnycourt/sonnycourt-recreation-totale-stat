// POST /api/oracle-es2-generate
// Body : { password, question }
// Cherche les réponses passées les plus proches, génère un brouillon dans le style perso.
// Protégé par mot de passe. N'envoie rien à personne : retourne juste le brouillon.

import { checkPassword, embedQuestion, generateDraft } from './lib/oracle-es2-shared.mjs';
import { supabasePost } from './lib/supabase-rest.mjs';
import { clientIpFromEvent, checkRateLimit, recordFailure, clearRateLimit } from './lib/oracle-es2-rate-limit.mjs';

const MATCH_COUNT = 5;

// --- Seuils d'assise (ajustables) ---
// Basés sur la similarité cosinus (0..1) des exemples récupérés. text-embedding-3-small :
// en français, des cas vraiment proches montent ~0.5+, des cas approchants ~0.4, le hors-sujet < 0.35.
const ASSISE_FORTE_MIN = 0.55;   // top similarité >= ce seuil => forte
const ASSISE_MOYENNE_MIN = 0.42; // top similarité >= ce seuil => moyenne (sinon faible)
const PROCHE_MIN = 0.45;         // un exemple compte comme "proche" au-dessus de ce seuil

function computeAssise(examples) {
  const sims = examples
    .map((e) => (typeof e.similarity === 'number' ? e.similarity : 0))
    .sort((a, b) => b - a);
  const top = sims.length ? sims[0] : 0;
  const procheCount = sims.filter((s) => s >= PROCHE_MIN).length;
  let level = 'faible';
  if (top >= ASSISE_FORTE_MIN) level = 'forte';
  else if (top >= ASSISE_MOYENNE_MIN) level = 'moyenne';
  return {
    level,
    topSimilarity: Math.round(top * 1000) / 1000,
    procheCount,
    totalRetrieved: sims.length,
  };
}

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

    const { draft, note } = await generateDraft({ question, examples });
    const assise = computeAssise(examples);

    return json(200, {
      ok: true,
      draft,
      note,
      assise,
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
