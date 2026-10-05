import {randomUUID} from 'node:crypto';
import {getSessionFromRequest} from './lib/admin-es2-verify-cookie.mjs';
import {invitation,makeToken,secret,digest,UUID_RE,InterviewError,planCommand,LEASE_MS,busy} from './lib/es2-interview-domain.mjs';
import {insertInvitation,listInterviews,getById,cas} from './lib/es2-interview-store.mjs';
import {json,guardOrigin,readBody,failure} from './lib/es2-interview-http.mjs';
import {wakeWorker} from './es2-entretien.js';
export default async(req)=>{
 if(!['GET','POST'].includes(req.method))return json(405,{error:'method_not_allowed'});
 try{
  guardOrigin(req);if(!getSessionFromRequest(req))throw new InterviewError('unauthorized',401);
  if(req.method==='GET'){
   const id=new URL(req.url).searchParams.get('id');
   if(!id)return json(200,{interviews:await listInterviews()});
   if(!UUID_RE.test(id))throw new InterviewError('invalid_id');
   const row=await getById(id);if(!row)throw new InterviewError('not_found',404);
   if(new URL(req.url).searchParams.get('format')==='pdf'){
    if(!row.summary?.pdf_base64||row.summary.pdf_stale||busy(row))throw new InterviewError('pdf_not_ready',409);
    return new Response(Buffer.from(row.summary.pdf_base64,'base64'),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="point-personnel-es2.pdf"','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
   }
   const {token_hash,...safe}=row;
   if(safe.summary){const {pdf_base64,...summary}=safe.summary;safe.summary={...summary,pdf_ready:!!pdf_base64&&!summary.pdf_stale};}
   return json(200,{interview:safe});
  }
  const body=await readBody(req,20000);
  if(['save_response','generate_pack'].includes(body.action)){
   if(!UUID_RE.test(body.id||''))throw new InterviewError('invalid_id');
   const row=await getById(body.id);if(!row||row.status!=='completed')throw new InterviewError('not_found',404);
   if(busy(row)&&(body.action==='save_response'||Date.parse(row.job.lease_until)>Date.now()))throw new InterviewError('busy',409);
   if(row.version!==body.version)throw new InterviewError('stale_version',409);
   if(body.action==='save_response'){
    if(!row.summary||typeof body.email!=='string'||!body.email.trim()||body.email.length>8000||typeof body.subject!=='string'||body.subject.length>250)throw new InterviewError('invalid_response');
    const changed=body.email.trim()!==row.summary.email?.body;
    const summary={...row.summary,email:{subject:body.subject.trim(),body:body.email.trim()},human_email:body.email.trim(),human_subject:body.subject.trim(),pdf_stale:row.summary.pdf_stale||changed};
    if(!await cas(row,{summary}))throw new InterviewError('stale_version',409);
   }else{
    const saved=await cas(row,{job:{id:randomUUID(),type:'summary',status:'queued',attempts:0,error:null,closure_reason:row.job?.closure_reason||'student',lease_until:new Date(Date.now()+LEASE_MS).toISOString()}});
    if(!saved)throw new InterviewError('stale_version',409);await wakeWorker(req,saved);
   }
   return json(200,{ok:true});
  }
  if(body.action==='retry_summary'){
   if(!UUID_RE.test(body.id||''))throw new InterviewError('invalid_id');
   const row=await getById(body.id);
   if(!row||row.status!=='completed'||row.job?.type!=='summary')throw new InterviewError('not_found',404);
   const patch=planCommand(row,{action:'retry',requestId:row.job.id});
   if(patch){const saved=await cas(row,patch);if(!saved)throw new InterviewError('busy',409);await wakeWorker(req,saved);}
   return json(200,{ok:true});
  }
  if(body.action!=='invite')throw new InterviewError('invalid_action');
  const row=await insertInvitation(invitation(body.email,body.firstName,secret()));
  if(row.status==='revoked')throw new InterviewError('revoked',409);
  const token=makeToken(row.id,secret());if(digest(token)!==row.token_hash)throw new InterviewError('token_secret_changed',503);
  // Stable link for the same normalized email, including when an interview is already completed.
  return json(200,{id:row.id,status:row.status,url:`https://sonnycourt.com/es2-entretien/#t=${token}`,email:row.email});
 }catch(error){return failure(error);}
};
