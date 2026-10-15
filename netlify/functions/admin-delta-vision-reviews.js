import {getSessionFromRequest} from './lib/admin-es2-verify-cookie.mjs';
import {supabaseGet} from './lib/supabase-rest.mjs';
import {reviewJson} from './lib/delta-review-validation.mjs';

export default async function handler(req) {
  if (req.method !== 'GET') return reviewJson(405, {error: 'Méthode non autorisée.'});
  try {
    const origin = req.headers.get('origin');
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
      return reviewJson(403, {error: 'Accès refusé.'});
    }
    if (!getSessionFromRequest(req)) return reviewJson(401, {error: 'Connexion administrateur requise.'});
    const page = Number(new URL(req.url).searchParams.get('page') || 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000) return reviewJson(400, {error: 'Page invalide.'});
    const result = await supabaseGet('delta_vision_reviews?select=id,first_name,email,rating,review,improvements,created_at&order=created_at.desc,id.desc&limit=51&offset=' + page * 50);
    if (!result.ok || !Array.isArray(result.data)) return reviewJson(503, {error: 'Avis indisponibles. Vérifie que le SQL a été exécuté.'});
    return reviewJson(200, {reviews: result.data.slice(0,50), hasMore: result.data.length > 50});
  } catch {return reviewJson(503, {error: 'Chargement indisponible.'});}
}
