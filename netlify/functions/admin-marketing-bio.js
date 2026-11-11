import { getMarketingSession } from './lib/marketing-auth.mjs';
import { database,json,sameOrigin } from './lib/marketing-links.mjs';
export default async function handler(req) {
  if(req.method!=='GET')return json(405,{error:'Méthode non autorisée.'});
  if(!sameOrigin(req))return json(403,{error:'Accès refusé.'});
  try {if(!await getMarketingSession(req))return json(401,{error:'Connecte-toi à Link Studio.'});}
  catch{return json(401,{error:'Connexion requise.'});}
  const days=new URL(req.url).searchParams.get('days')||'0';
  if(!['0','7','30'].includes(days))return json(400,{error:'Période invalide.'});
  try{return json(200,await database('rpc/marketing_bio_report',{p_days:Number(days)}));}
  catch(e){return json(503,{error:e.message==='schema_missing'?'Le suivi sera disponible après exécution de marketing_bio_choices_v1.sql.':'Les statistiques sont momentanément indisponibles.'});}
}
