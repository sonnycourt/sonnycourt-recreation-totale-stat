// Logique partagée de l'outil /oracle-es2 :
// - vérification du mot de passe (jamais en dur, vit dans ORACLE_ES2_PASSWORD)
// - génération d'embedding via OpenAI text-embedding-3-small (1536 dims)
// - génération du brouillon via l'API Claude (Opus 4.8)

import crypto from 'node:crypto';

/** Compare le mot de passe soumis à ORACLE_ES2_PASSWORD (timing-safe). */
export function checkPassword(submitted) {
  const expected = process.env.ORACLE_ES2_PASSWORD;
  if (!expected) return { ok: false, reason: 'config' };
  const a = Buffer.from(String(submitted ?? ''));
  const b = Buffer.from(expected);
  // timingSafeEqual exige des longueurs égales : on court-circuite proprement.
  if (a.length !== b.length) return { ok: false, reason: 'invalid' };
  const valid = crypto.timingSafeEqual(a, b);
  return { ok: valid, reason: valid ? null : 'invalid' };
}

/** Embedding de la question via OpenAI. Retourne un tableau de 1536 floats. */
export async function embedQuestion(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY manquant');

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embedding OpenAI échoué (${res.status}): ${t}`);
  }
  const data = await res.json();
  return data?.data?.[0]?.embedding;
}

const NOTE_MARKER = '===RELECTURE===';

const SYSTEM_PROMPT = `Tu écris des réponses aux bilans des membres premium d'une formation, à la place de leur mentor. Tu imites fidèlement SA voix à partir des exemples fournis.

Style à respecter absolument :
- Direct, fraternel, franc. Pas de flatterie, pas de langue de bois.
- Français casual, comme un message d'un grand frère qui maîtrise son sujet.
- Aucun coaching condescendant, aucune formule creuse de coach.
- INTERDICTION ABSOLUE du tiret cadratin (—). Ne l'utilise JAMAIS, dans aucun contexte. À la place : des phrases courtes, des virgules, des points, des deux-points ou des parenthèses.
- Calque le ton, le vocabulaire, la longueur et la façon de penser des exemples fournis.

Quand un exemple contient un raisonnement, sers-t'en pour comprendre la logique de l'angle choisi, pas seulement les mots.

FORMAT DE SORTIE (deux parties, dans cet ordre) :
1. Le brouillon de la réponse, prêt à être copié tel quel. Pas de préambule, pas de méta-commentaire, pas d'options, pas de tiret cadratin.
2. Sur une nouvelle ligne, exactement le marqueur ${NOTE_MARKER}, puis UNE seule phrase courte indiquant quelle partie de ta réponse est la moins ancrée dans les exemples fournis (la partie que tu as le plus inventée de toi-même), pour orienter la relecture. Drapeau qualitatif, pas de pourcentage. Si tout est bien couvert par les exemples, dis-le en une phrase.

Ne mets RIEN après cette phrase. Le brouillon (partie 1) ne doit jamais contenir le marqueur ni la note.`;

/** Construit le bloc d'exemples (réponse + raisonnement quand dispo). */
function formatExamples(examples) {
  return examples
    .map((e, i) => {
      let s = `### Exemple ${i + 1}\nQuestion reçue :\n${e.question}\n\nMa réponse :\n${e.reponse}`;
      if (e.raisonnement && String(e.raisonnement).trim()) {
        s += `\n\nMon raisonnement (pourquoi cet angle) :\n${e.raisonnement}`;
      }
      return s;
    })
    .join('\n\n');
}

/** Génère le brouillon dans le style perso à partir des exemples les plus proches. */
export async function generateDraft({ question, examples }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY manquant');

  const exBlock = examples.length
    ? `Voici des exemples de mes réponses passées, les plus proches sémantiquement de la nouvelle question :\n\n${formatExamples(examples)}`
    : `Je n'ai pas encore d'exemple proche en base. Reste fidèle au style décrit dans tes instructions.`;

  const userContent = `${exBlock}\n\n---\n\nNouvelle question à laquelle répondre dans mon style :\n${question}\n\nÉcris le brouillon de ma réponse. Réponds UNIQUEMENT avec le brouillon, sans préambule ni commentaire.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude échoué (${res.status}): ${t}`);
  }
  const data = await res.json();
  const text = (data?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Sépare le brouillon (copiable) de la note de relecture.
  const idx = text.indexOf(NOTE_MARKER);
  if (idx === -1) {
    return { draft: text, note: null };
  }
  const draft = text.slice(0, idx).trim();
  const note = text.slice(idx + NOTE_MARKER.length).trim() || null;
  return { draft, note };
}
