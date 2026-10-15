import {getSessionFromRequest} from './lib/admin-es2-verify-cookie.mjs';
import {supabasePost} from './lib/supabase-rest.mjs';
import {json,label} from './lib/delta-analytics-contract.mjs';
import {readDeltaSales} from './lib/delta-analytics-sales.mjs';
export default async function handler(req){
 if(req.method!=='GET')return json(405,{error:'Méthode non autorisée.'});
 if((req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)||req.headers.get('sec-fetch-site')==='cross-site')return json(403,{error:'Accès refusé.'});
 if(!getSessionFromRequest(req))return json(401,{error:'Connexion administrateur requise.'});
 const q=new URL(req.url).searchParams,from=Date.parse(q.get('from')),to=Date.parse(q.get('to')),now=Date.now();
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>32*86400000||from<now-90*86400000||to>now+86400000)return json(400,{error:'Choisis une période de 31 jours maximum, dans les 90 derniers jours.'});
 const device=q.get('device')||'',price=Number(q.get('price')||0),source=label(q.get('source')||'');
 if(!['','mobile','desktop'].includes(device)||![0,27,47].includes(price))return json(400,{error:'Filtre invalide.'});
 try{
  const result=await supabasePost('rpc/delta_vision_analytics_report',{p_from:new Date(from).toISOString(),p_to:new Date(to).toISOString(),p_source:source,p_device:device,p_price:price});
  if(!result.ok)return json(503,{error:'Tracking indisponible : vérifie l’exécution du SQL.'});
  const report=result.data;
  if(report.visit_count>10000)return json(422,{error:'Plus de 10 000 visites : réduis la période pour afficher des statistiques complètes.'});
  let commerce={available:false,sales:[],reason:'Clique sur « Vérifier les ventes Spiffy ».'};
  if(q.get('sales')==='1'){try{commerce=await readDeltaSales(new Date(from).toISOString());}catch{commerce={available:false,sales:[],reason:'Lecture Spiffy indisponible ou incomplète. Aucun chiffre de vente inventé.'};}}
  return json(200,{...report,commerce,from:new Date(from).toISOString(),to:new Date(to).toISOString(),generated_at:new Date().toISOString()});
 }catch{return json(503,{error:'Rapport momentanément indisponible.'});}
}
