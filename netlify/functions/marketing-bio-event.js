import { UUID, CODE } from '../../src/lib/marketing-links-contract.mjs';
import { database, json, productionRequest, sameOrigin } from './lib/marketing-links.mjs';

const sources=new Set(['tiktok','youtube','instagram','facebook','email','sms','meta_ads','direct','other']);
export default async function handler(req) {
  if(req.method!=='POST')return json(405,{error:'Méthode non autorisée.'});
  if(!sameOrigin(req,true))return json(403,{error:'Accès refusé.'});
  if(!productionRequest(req))return json(200,{skipped:'preview'});
  if(!req.headers.get('content-type')?.includes('application/json'))return json(415,{error:'Format invalide.'});
  if(/bot|spider|crawler|preview|facebookexternalhit|slackbot|headless/i.test(req.headers.get('user-agent')||''))return json(200,{skipped:'automated'});
  try {
    const raw=await req.text();if(raw.length>800)return json(413,{error:'Requête trop grande.'});
    let body;try{body=JSON.parse(raw);}catch{return json(400,{error:'Mesure invalide.'});}
    if(!UUID.test(body?.id||'')||body.visible!==true||!['/links','/links/'].includes(body.path)
      ||!sources.has(body.source)||(body.code!==null&&!CODE.test(body.code||''))
      ||(body.choice!==null&&!['mc2','delta'].includes(body.choice)))return json(400,{error:'Mesure invalide.'});
    const ok=await database('rpc/marketing_record_bio_visit',{p_id:body.id,p_code:body.code,p_source:body.source,p_choice:body.choice});
    return ok===true?json(200,{ok:true}):json(409,{error:'Mesure non enregistrée.'});
  }catch{return json(503,{error:'Mesure momentanément indisponible.'});}
}
export const config={rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
