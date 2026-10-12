import {deltaIdentity,deltaJson,saveDeltaSubscriber} from './lib/delta-vision-mailerlite.mjs';

export const config={path:'/.netlify/functions/delta-vision-register',rateLimit:{windowLimit:12,windowSize:60,aggregateBy:['ip','domain']}};
export default async function handler(req) {
  if (req.method !== 'POST') return deltaJson(405,{ok:false});
  const ownOrigin=new URL(req.url).origin;
  if (req.headers.get('origin') !== ownOrigin) return deltaJson(403,{ok:false});
  if (!req.headers.get('content-type')?.startsWith('application/json')) return deltaJson(415,{ok:false});
  if (Number(req.headers.get('content-length')) > 4096) return deltaJson(413,{ok:false});
  let input;
  try {const raw=await req.text();if(raw.length>4096)return deltaJson(413,{ok:false});input=JSON.parse(raw);} catch {return deltaJson(400,{ok:false});}
  if (input?.website) return deltaJson(400,{ok:false});
  const identity=deltaIdentity(input);
  if (!identity) return deltaJson(400,{ok:false});
  try {await saveDeltaSubscriber(identity);return deltaJson(200,{ok:true});}
  catch {return deltaJson(503,{ok:false});}
}
