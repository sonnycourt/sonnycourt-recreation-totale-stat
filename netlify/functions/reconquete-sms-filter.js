// Read-only preflight for the private campaign sender. Never sends messages.
import {timingSafeEqual} from 'node:crypto';
import {makeSmsStopService,normalizeStopPhone} from './lib/reconquete-sms-stop.mjs';
const service=makeSmsStopService();
export default async req=>{
  const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='POST')return json(405,{error:'method'});
  const expected=Buffer.from('Bearer '+String(process.env.GATEWAYAPI_TOKEN||''));
  const actual=Buffer.from(req.headers.get('authorization')||'');
  if(!process.env.GATEWAYAPI_TOKEN||actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(401,{error:'unauthorized'});
  try{
    const raw=await req.text();if(raw.length>100000)return json(400,{error:'size'});
    const body=JSON.parse(raw);
    if(!Array.isArray(body.phones)||body.phones.length>2500)return json(400,{error:'phones'});
    const phones=[...new Set(body.phones.map(normalizeStopPhone))];
    if(phones.includes(''))return json(400,{error:'invalid_phone'});
    const blocked=[];
    for(let i=0;i<phones.length;i+=25){await Promise.all(phones.slice(i,i+25).map(async phone=>{if(await service.isBlocked(phone))blocked.push(phone);}));}
    return json(200,{blocked,checked:phones.length});
  }catch{return json(503,{error:'filter_unavailable_do_not_send'});}
};
