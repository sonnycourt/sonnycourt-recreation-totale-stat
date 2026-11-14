import {deltaJson} from './lib/delta-vision-mailerlite.mjs';
import {dvpDb,validToken,publicAccess,requestBody} from './lib/dvp-access.mjs';
export const config={path:'/.netlify/functions/dvp-access',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
export function createHandler({env=process.env,fetcher=fetch,db=dvpDb}={}){
 return async req=>{
  const {input,status}=await requestBody(req);if(status)return deltaJson(status,{ok:false});
  if(!validToken(input.token)||!['resolve','progress'].includes(input.action))return deltaJson(400,{ok:false});
  try{
    const options={env,fetcher};
    const rows=await db(`dvp_access?token=eq.${input.token}&select=token,expires_at,position_seconds,offer_unlocked&limit=1`,options);
    if(!rows?.[0])return deltaJson(404,{ok:false});
    if(input.action==='progress'){
      if(!Number.isFinite(input.position)||input.position<0||input.position>86400||typeof input.offerUnlocked!=='boolean')return deltaJson(400,{ok:false});
      await db('rpc/dvp_save_progress',{...options,method:'POST',body:{p_token:input.token,p_position:input.position,p_unlocked:input.offerUnlocked}});
      return deltaJson(200,{ok:true});
    }
    // Token grants presentation access only. Never return email or billing details.
    return deltaJson(200,{ok:true,access:publicAccess(rows[0])});
  }catch{return deltaJson(503,{ok:false});}
 };
}
export default createHandler();
