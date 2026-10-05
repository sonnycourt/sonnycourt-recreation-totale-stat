import {randomUUID} from 'node:crypto';
import {getById,cas} from './lib/es2-interview-store.mjs';
import {secret,jobSignature,validSignature,UUID_RE,LEASE_MS,CLOSING,LIMIT_CLOSING,STOP_CLOSING} from './lib/es2-interview-domain.mjs';
import {answerCount,closingReason,lastGuide,MAX_INTERVIEW_TURNS} from './lib/es2-interview-guide.mjs';
import {readBody} from './lib/es2-interview-http.mjs';
import {makeReportPdf} from './lib/es2-interview-pdf.mjs';
import {GUIDE_VERSION} from './lib/es2-interview-guide.mjs';
import {generate} from './lib/es2-interview-model.mjs';
import {wakeWorker} from './es2-entretien.js';

async function completeInterview(req, claimed, reply, reason, model) {
 const now=new Date().toISOString();
 const closing=reason==='safety'
  ? `${reply.reply}\n\nL’entretien est arrêté. Tes messages sont enregistrés, mais cet espace n’est pas suivi en direct et ne peut pas déclencher d’aide urgente.`
  : reason==='student'?(reply.reply||STOP_CLOSING):reason==='limit'?LIMIT_CLOSING:CLOSING;
 const saved=await cas(claimed,{
  status:'completed',completed_at:now,
  messages:[...claimed.messages,{role:'assistant',text:closing,interview:{guide_version:GUIDE_VERSION,coverage:reply.coverage,next_area:'closing',reason}}],
  job:{id:randomUUID(),type:'summary',status:'queued',attempts:0,error:null,closure_reason:reason,model,lease_until:new Date(Date.now()+LEASE_MS).toISOString()},
 });
 // The closing and the summary job are persisted atomically. A duplicate worker cannot close twice.
 if(saved)await wakeWorker(req,saved);
}

// All work is leased and fenced by the row version; duplicate deliveries cannot append twice.
export default async(req)=>{
 if(req.method!=='POST')return;
 let body;try{body=await readBody(req);}catch{return;}
 if(!UUID_RE.test(body.id||'')||!UUID_RE.test(body.jobId||''))return;
 if(!validSignature(body.signature,jobSignature(body.id,body.jobId,secret())))return;
 const row=await getById(body.id);
 if(!row||row.status==='revoked'||row.job?.id!==body.jobId||row.job.attempts>=3)return;
 if(row.job.status!=='queued'&&!(row.job.status==='processing'&&Date.parse(row.job.lease_until)<Date.now()))return;
 let claimed=await cas(row,{job:{...row.job,status:'processing',attempts:row.job.attempts+1,lease_until:new Date(Date.now()+LEASE_MS).toISOString()}});
 if(!claimed)return;
 try{
  const result=await generate(claimed,{onPreview:async preview=>{
   const saved=await cas(claimed,{job:{...claimed.job,preview}});
   if(!saved)throw Object.assign(new Error('superseded'),{code:'superseded'});
   claimed=saved;
  }});
  if(claimed.job.type==='reply'){
   const reason=closingReason(claimed,result.value);
   if(reason){await completeInterview(req,claimed,result.value,reason,result.model);return;}
  }
  const patch={job:{...claimed.job,status:'done',model:result.model,error:null,preview:null}};
  if(claimed.job.type==='summary'){const pdf=await makeReportPdf(result.value,claimed.first_name);patch.summary={...result.value,human_email:claimed.summary?.human_email||null,human_subject:claimed.summary?.human_subject||null,pdf_base64:pdf.toString('base64'),pdf_stale:false,generated_at:new Date().toISOString()};}
  else patch.messages=[...claimed.messages,{role:'assistant',text:result.value.reply,interview:{guide_version:GUIDE_VERSION,coverage:result.value.coverage,next_area:result.value.next_area}}];
  await cas(claimed,patch);
 }catch(error){
  if(error.code==='superseded')return;
  if(claimed.job.type==='reply'&&answerCount(claimed)>=MAX_INTERVIEW_TURNS){
   await completeInterview(req,claimed,{coverage:lastGuide(claimed).coverage},'limit',null);return;
  }
  await cas(claimed,{job:{...claimed.job,status:'failed',error:error.code||'model_unavailable'}});
  console.warn('[es2-interview] generation failed:',error.code||'unavailable');
 }
};
