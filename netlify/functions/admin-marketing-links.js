import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { validateCreate } from '../../src/lib/marketing-links-contract.mjs';
import { database, json, sameOrigin } from './lib/marketing-links.mjs';

export default async function handler(req) {
  if (!['GET', 'POST'].includes(req.method)) return json(405, { error: 'Méthode non autorisée.' });
  if (!sameOrigin(req, req.method === 'POST')) return json(403, { error: 'Accès refusé.' });
  try { if (!getSessionFromRequest(req)) return json(401, { error: 'Connecte-toi au cockpit pour gérer les liens.' }); }
  catch { return json(401, { error: 'Connexion administrateur requise.' }); }
  try {
    if (req.method === 'GET') {
      const data = await database('rpc/marketing_links_overview', {});
      return json(200, { ...data, connected: true });
    }
    if (!req.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'Format JSON requis.' });
    const raw = await req.text(); if (raw.length > 5000) return json(413, { error: 'Formulaire trop volumineux.' });
    let input;
    try { input = validateCreate(JSON.parse(raw)); } catch (e) { return json(400, { error: e.message || 'Formulaire invalide.' }); }
    const data = await database('rpc/marketing_create_link', { p_input: input });
    return json(200, { link: data });
  } catch (e) {
    return json(503, { code: e.message === 'schema_missing' ? 'schema_missing' : 'unavailable', error: e.message === 'schema_missing' ? 'La connexion est prête. Exécute le SQL marketing_links_v1 dans Supabase pour activer le registre.' : 'Supabase est momentanément indisponible. Réessaie sans modifier le formulaire.' });
  }
}
