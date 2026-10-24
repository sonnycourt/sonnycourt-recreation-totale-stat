import {deltaIdentity,deltaJson,saveDeltaSubscriber} from './lib/delta-vision-mailerlite.mjs';
import {cleanMetaAttribution,recordMetaLead} from './lib/delta-meta-attribution.mjs';

export const config={path:'/.netlify/functions/delta-vision-register',rateLimit:{windowLimit:12,windowSize:60,aggregateBy:['ip','domain']}};
export default async function handler(req) {
  const ownOrigin=new URL(req.url).origin;
  const origin=req.headers.get('origin');
  const hosted=origin==='https://sonnycourt.spiffy.co';
  if (origin !== ownOrigin && !hosted) return deltaJson(403,{ok:false});
  const reply=(status,body)=>{
    const response=deltaJson(status,body);
    if(hosted){
      response.headers.set('Access-Control-Allow-Origin',origin);
      response.headers.set('Vary','Origin');
      response.headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers','Content-Type');
    }
    return response;
  };
  if (req.method==='OPTIONS') return reply(200,{ok:true});
  if (req.method !== 'POST') return reply(405,{ok:false});
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply(415,{ok:false});
  if (Number(req.headers.get('content-length')) > 4096) return reply(413,{ok:false});
  let input;
  try {const raw=await req.text();if(raw.length>4096)return reply(413,{ok:false});input=JSON.parse(raw);} catch {return reply(400,{ok:false});}
  if (input?.website) return reply(400,{ok:false});
  if (hosted && !['41049','41096'].includes(input?.checkoutId)) return reply(400,{ok:false});
  const identity=deltaIdentity(input,{emailOnly:hosted});
  if (!identity) return reply(400,{ok:false});
  // Trafic venu d'une pub Meta uniquement : Lead CAPI dédupliqué avec le pixel, puis mémorisation pour le Purchase serveur.
  // En parallèle de MailerLite pour ne pas allonger l'attente ; seul MailerLite décide du succès.
  const attribution=hosted?null:cleanMetaAttribution(input.meta);
  const [saved]=await Promise.allSettled([saveDeltaSubscriber(identity),attribution?recordMetaLead({email:identity.email,attribution,req}):null]);
  return saved.status==='fulfilled'?reply(200,{ok:true}):reply(503,{ok:false});
}
