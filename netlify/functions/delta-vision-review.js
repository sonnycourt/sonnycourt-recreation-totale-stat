import {supabasePost} from './lib/supabase-rest.mjs';
import {validateDeltaReview, reviewJson} from './lib/delta-review-validation.mjs';

export const config = {path: '/.netlify/functions/delta-vision-review',
  rateLimit: {windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain']}};

export default async function handler(req) {
  if (req.method !== 'POST') return reviewJson(405, {error: 'Méthode non autorisée.'});
  if (req.headers.get('origin') !== new URL(req.url).origin) return reviewJson(403, {error: 'Origine non autorisée.'});
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return reviewJson(415, {error: 'Format non pris en charge.'});
  }
  // Both the declared size and actual body are checked (UTF-8, not character count).
  if (Number(req.headers.get('content-length')) > 90000) return reviewJson(413, {error: 'Texte trop long.'});
  let input;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 90000) return reviewJson(413, {error: 'Texte trop long.'});
    input = JSON.parse(raw);
  } catch {return reviewJson(400, {error: 'Formulaire invalide.'});}
  const row = validateDeltaReview(input);
  if (!row) return reviewJson(400, {error: 'Vérifie ton prénom, ton email, ta note et ton commentaire.'});
  try {
    // Retry-safe: a network retry cannot overwrite a review or create a second copy.
    const saved = await supabasePost('delta_vision_reviews?on_conflict=id', row,
      {prefer: 'resolution=ignore-duplicates,return=minimal'});
    if (!saved.ok) return reviewJson(503, {error: 'Ton avis n’a pas pu être enregistré. Réessaie dans un instant.'});
    return reviewJson(200, {ok: true});
  } catch {return reviewJson(503, {error: 'Connexion indisponible. Ton texte est conservé dans le formulaire.'});}
}
