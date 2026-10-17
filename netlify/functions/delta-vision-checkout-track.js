import {json,uuid} from './lib/delta-analytics-contract.mjs';
import {supabaseGet,supabasePost} from './lib/supabase-rest.mjs';
const cors={'Access-Control-Allow-Origin':'https://sonnycourt.spiffy.co','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
export default async function handler(req){
 if(req.headers.get('origin')!=='https://sonnycourt.spiffy.co')return json(403,{ok:false});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return json(405,{ok:false},cors);
 try{
  const raw=await req.text();if(raw.length>1024)return json(413,{ok:false},cors);
  const b=JSON.parse(raw);if(!uuid(b.id)||!uuid(b.visit_id)||!['41049','41096'].includes(b.checkout))return json(400,{ok:false},cors);
  const result=await supabaseGet(`delta_vision_analytics_events?visit_id=eq.${b.visit_id}&event_name=eq.visit&visit_started_at=gte.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&select=visit_id,visitor_id,visit_started_at,source,medium,campaign,device,is_returning&limit=1`);
  if(!result.ok)return json(503,{ok:false},cors);
  if(!result.data?.[0])return json(200,{ok:true,ignored:true},cors);
  const insert=await supabasePost('delta_vision_analytics_events?on_conflict=id',{...result.data[0],id:b.id,event_name:'checkout_loaded',price:b.checkout==='41096'?147:97,metadata:{checkout:b.checkout}},{prefer:'resolution=ignore-duplicates,return=minimal'});
  return json(insert.ok?200:503,{ok:insert.ok},cors);
 }catch{return json(400,{ok:false},cors);}
}
export const config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
