import {getById,cas} from './lib/es2-interview-store.mjs';
import {secret,jobSignature,validSignature,UUID_RE,LEASE_MS} from './lib/es2-interview-domain.mjs';
import {readBody} from './lib/es2-interview-http.mjs';
import {generate} from './lib/es2-interview-model.mjs';
// All work is leased and fenced by the row version; duplicate deliveries cannot append twice.
export default async(req)=>{
 if(req.method!=='POST')return;
 let body;try{body=await readBody(req);}catch{return;}
 if(!UUID_RE.test(body.id||'')||!UUID_RE.test(body.jobId||''))return;
 if(!validSignature(body.signature,jobSignature(body.id,body.jobId,secret())))return;
 let row=await getById(body.id);
 if(!row||row.status==='revoked'||row.job?.id!==body.jobId||row.job.attempts>=3)return;
 if(row.job.status!=='queued'&&!(row.job.status==='processing'&&Date.parse(row.job.lease_until)<Date.now()))return;
 const claimed=await cas(row,{job:{...row.job,status:'processing',attempts:row.job.attempts+1,lease_until:new Date(Date.now()+LEASE_MS).toISOString()}});
 if(!claimed)return;
 try{
  const result=await generate(claimed);
  const patch={job:{...claimed.job,status:'done',model:result.model,error:null,ready_to_finish:!!result.value.ready_to_finish}};
  if(claimed.job.type==='summary')patch.summary=result.value;
  else patch.messages=[...claimed.messages,{role:'assistant',text:result.value.reply}];
  await cas(claimed,patch);
 }catch(error){await cas(claimed,{job:{...claimed.job,status:'failed',error:error.code||'model_unavailable'}});console.warn('[es2-interview] generation failed:',error.code||'unavailable');}
};
