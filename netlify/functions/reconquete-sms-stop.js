import {makeSmsStopService} from './lib/reconquete-sms-stop.mjs';
const service=makeSmsStopService();
export default async req=>{
  const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='POST')return json(405,{error:'Méthode non autorisée.'});
  if(req.headers.get('origin')!==new URL(req.url).origin)return json(403,{error:'Origine non autorisée.'});
  try{
    const text=await req.text();
    if(text.length>500)return json(400,{error:'Requête invalide.'});
    const body=JSON.parse(text);
    const result=await service.unsubscribe(body.phone,body.confirmed);
    return json(result.status,result.data);
  }catch{return json(503,{error:'Enregistrement indisponible. Réessaie dans un instant.'});}
};
