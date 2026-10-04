import {digest,TOKEN_RE,planCommand,publicSession,secret,jobSignature,InterviewError} from './lib/es2-interview-domain.mjs';
import {getByHash,cas} from './lib/es2-interview-store.mjs';
import {json,guardOrigin,readBody,failure} from './lib/es2-interview-http.mjs';
export async function wakeWorker(req,row){
 const origin=new URL(req.url).origin;
 const signature=jobSignature(row.id,row.job.id,secret());
 try{const response=await fetch(`${origin}/.netlify/functions/es2-entretien-worker-background`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,jobId:row.job.id,signature}),signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('queue');}
 catch{await cas(row,{job:{...row.job,status:'failed',error:'queue_unavailable'}});}
}
export default async(req)=>{
 if(!['GET','POST'].includes(req.method))return json(405,{error:'method_not_allowed'});
 try{
  guardOrigin(req);
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
  if(!TOKEN_RE.test(token))throw new InterviewError('invalid_link',401);
  const hash=digest(token);let row=await getByHash(hash);
  if(!row||row.status==='revoked')throw new InterviewError('invalid_link',401);
  if(req.method==='GET')return json(200,publicSession(row));
  const body=await readBody(req);
  if(!process.env.ANTHROPIC_API_KEY&&!process.env.ANTHROPIC_API_KEY_ES2_ENTRETIEN)throw new InterviewError('model_not_ready',503);
  for(let attempt=0;attempt<3;attempt++){
   const patch=planCommand(row,body);
   if(!patch)return json(200,publicSession(row));
   const saved=await cas(row,patch);
   if(saved){if(patch.job?.status==='queued')await wakeWorker(req,saved);return json(200,publicSession(await getByHash(hash)));}
   row=await getByHash(hash);if(!row)throw new InterviewError('invalid_link',401);
  }
  throw new InterviewError('busy',409);
 }catch(error){return failure(error);}
};
