import {cleanBatch,json} from './lib/delta-analytics-contract.mjs';
import {supabasePost} from './lib/supabase-rest.mjs';
export default async function handler(req){
 if(req.method!=='POST')return json(405,{ok:false});
 const origin=req.headers.get('origin');
 if(origin!==new URL(req.url).origin||req.headers.get('sec-fetch-site')==='cross-site')return json(403,{ok:false});
 let rows;
 try{const raw=await req.text();if(raw.length>60000)return json(413,{ok:false});rows=cleanBatch(JSON.parse(raw));}catch{return json(400,{ok:false});}
 try{const result=await supabasePost('delta_vision_analytics_events?on_conflict=id',rows,{prefer:'resolution=ignore-duplicates,return=minimal'});return json(result.ok?200:503,{ok:result.ok});}catch{return json(503,{ok:false});}
}
export const config={rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
