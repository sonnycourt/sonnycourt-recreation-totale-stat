import {deltaIdentity,deltaJson} from './lib/delta-vision-mailerlite.mjs';

export const config={path:'/.netlify/functions/lead-magnet-register',rateLimit:{windowLimit:8,windowSize:60,aggregateBy:['ip','domain']}};

export function createHandler({env=process.env,fetcher=fetch}={}){
  return async function handler(req){
    if(req.method!=='POST')return deltaJson(405,{ok:false});
    if(req.headers.get('origin')!==new URL(req.url).origin)return deltaJson(403,{ok:false});
    if(!req.headers.get('content-type')?.startsWith('application/json'))return deltaJson(415,{ok:false});
    if(Number(req.headers.get('content-length'))>4096)return deltaJson(413,{ok:false});
    let input;
    try{const raw=await req.text();if(raw.length>4096)return deltaJson(413,{ok:false});input=JSON.parse(raw);}catch{return deltaJson(400,{ok:false});}
    const identity=deltaIdentity(input);
    if(!identity||input.slug!=='papa'||input.website||input.consent!==true)return deltaJson(400,{ok:false});
    // Fermé par défaut en production. Aucun changement des variables Netlify.
    if(env.LEAD_MAGNET_PAPA_ENABLED!=='true'||!env.MAILERLITE_API_KEY||!/^\d+$/.test(env.MAILERLITE_GROUP_LEAD_MAGNET_PAPA||''))return deltaJson(503,{ok:false});
    try{
      const response=await fetcher('https://connect.mailerlite.com/api/subscribers',{
        method:'POST',headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},
        // Ne jamais forcer le statut, réabonner, ni remplacer les autres groupes.
        body:JSON.stringify({email:identity.email,fields:{name:identity.firstName},groups:[env.MAILERLITE_GROUP_LEAD_MAGNET_PAPA],resubscribe:false}),
        signal:AbortSignal.timeout(10000),
      });
      if(!response.ok)return deltaJson(503,{ok:false});
      const result=await response.json();
      if(!result.data?.id)return deltaJson(503,{ok:false});
      return deltaJson(200,{ok:true});
    }catch{return deltaJson(503,{ok:false});}
  };
}
export default createHandler();
