import {deltaIdentity,deltaJson} from './lib/delta-vision-mailerlite.mjs';
import {dvpDb,publicAccess,requestBody,DVP_GROUP_ID} from './lib/dvp-access.mjs';
export const config={path:'/.netlify/functions/dvp-register',rateLimit:{windowLimit:8,windowSize:60,aggregateBy:['ip','domain']}};
export function createHandler({env=process.env,fetcher=fetch,db=dvpDb}={}){
 return async req=>{
  const {input,status}=await requestBody(req);if(status)return deltaJson(status,{ok:false});
  const identity=deltaIdentity(input);if(!identity||input.website||input.consent!==true)return deltaJson(400,{ok:false});
  if(!env.MAILERLITE_API_KEY)return deltaJson(503,{ok:false});
  let browserDeadline=null;
  if(input.browserDeadline!==null && input.browserDeadline!==undefined){
    if(!Number.isSafeInteger(input.browserDeadline)||input.browserDeadline<=0||input.browserDeadline>Date.now()+86400000)return deltaJson(400,{ok:false});
    browserDeadline=new Date(input.browserDeadline).toISOString();
  }
  try{
    const options={env,fetcher};
    const rows=await db('rpc/dvp_register_access',{...options,method:'POST',body:{p_email:identity.email,p_first_name:identity.firstName,p_browser_deadline:browserDeadline}});
    const row=rows?.[0];if(!row?.token)throw Error('missing_access');
    const personalUrl=`https://sonnycourt.com/dvp/#dvp=${row.token}`;
    const response=await fetcher('https://connect.mailerlite.com/api/subscribers',{
      method:'POST',headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({email:identity.email,fields:{name:identity.firstName,dvp_personal_url:personalUrl,dvp_offer_deadline:row.expires_at,dvp_reminder_at:new Date(Date.parse(row.expires_at)-2*3600000).toISOString()},groups:[DVP_GROUP_ID],resubscribe:false}),signal:AbortSignal.timeout(10000),
    });
    if(!response.ok||!(await response.json()).data?.id)throw Error('mailerlite_error');
    // No workflow is activated here. The reminder needs Sonny's message approval.
    await db(`dvp_access?token=eq.${row.token}`,{...options,method:'PATCH',body:{mailerlite_synced_at:new Date().toISOString()}});
    return deltaJson(200,{ok:true,access:publicAccess(row)});
  }catch{return deltaJson(503,{ok:false});}
 };
}
export default createHandler();
