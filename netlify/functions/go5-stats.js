import {timingSafeEqual} from 'node:crypto';
import {go5Store,localDay} from './lib/go5-tracking.mjs';
export default async req=>{
  const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='GET')return json(405,{error:'method'});
  const expected=Buffer.from('Bearer '+String(process.env.GATEWAYAPI_TOKEN||'')),actual=Buffer.from(req.headers.get('authorization')||'');
  if(!process.env.GATEWAYAPI_TOKEN||actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(401,{error:'unauthorized'});
  const day=new URL(req.url).searchParams.get('day')||localDay();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day)))return json(400,{error:'invalid_day'});
  try{
    const result=await go5Store().list({prefix:day+'/'});
    const automated=result.blobs.filter(b=>b.key.includes('/automated/')).length;
    return json(200,{day,timeZone:'Europe/Zurich',redirect_requests:result.blobs.length,recognized_automated:automated,unclassified_visits:result.blobs.length-automated,unique_people:null,note:'Requêtes GET seulement. Les visites non classées peuvent encore inclure des robots et des clics répétés. Les HEAD ne comptent pas.'});
  }catch{return json(503,{error:'statistics_unavailable'});}
};
