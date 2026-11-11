import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { json, sameOrigin } from './lib/marketing-links.mjs';
import { readMarketingPurchases, readMarketingJourney } from './lib/marketing-journeys.mjs';

export default async function handler(req) {
  if (req.method!=='GET') return json(405,{error:'Méthode non autorisée.'});
  if (!sameOrigin(req,false)) return json(403,{error:'Accès refusé.'});
  try { if (!getSessionFromRequest(req)) return json(401,{error:'Connexion administrateur requise.'}); }
  catch {return json(401,{error:'Connexion administrateur requise.'});}
  const id=new URL(req.url).searchParams.get('purchase');
  if (id!==null && !/^[1-9]\d*$/.test(id)) return json(400,{error:'Achat invalide.'});
  try {
    const data=id ? await readMarketingJourney(id) : await readMarketingPurchases();
    return data ? json(200,data) : json(404,{error:'Achat introuvable.'});
  } catch {return json(503,{error:'Le parcours est momentanément indisponible. Réessaie.'});}
}
