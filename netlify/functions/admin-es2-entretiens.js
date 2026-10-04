import {getSessionFromRequest} from './lib/admin-es2-verify-cookie.mjs';
import {invitation,makeToken,secret,digest,UUID_RE,InterviewError,planCommand} from './lib/es2-interview-domain.mjs';
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
   const {token_hash,...safe}=row;return json(200,{interview:safe});
  }
  const body=await readBody(req);
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
