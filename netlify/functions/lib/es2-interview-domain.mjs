import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {MAX_INTERVIEW_TURNS,GUIDE_VERSION,blankCoverage,questionUI,instantReply,closingReason} from './es2-interview-guide.mjs';
export const MAX_TURNS = MAX_INTERVIEW_TURNS;
export const MAX_TEXT = 4000;
export const LEASE_MS = 240000;
export const TOKEN_RE = /^ei1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const GREETING = 'Bonjour, je suis l’assistante IA de Sonny. Je vais te guider pour comprendre ce que tu vis, ton histoire et ce vers quoi tu veux avancer. Tu peux passer toute question. Sonny recevra tes réponses et préparera son retour personnel sous 7 jours.\n\nQu’est-ce qui te pèse le plus dans ta vie en ce moment ?';
export const CLOSING = 'Merci d’avoir partagé ce qui compte pour toi. Ton entretien est maintenant terminé et tes réponses sont enregistrées pour Sonny. Il prendra connaissance de ta situation et te répondra personnellement sous 7 jours.';
export const LIMIT_CLOSING = 'Merci pour tout ce que tu as partagé. Je termine ici pour ne pas prolonger cet entretien. Tes réponses et les points encore ouverts sont enregistrés pour Sonny. Il te répondra personnellement sous 7 jours.';
export const STOP_CLOSING = 'Nous nous arrêtons ici, comme tu le souhaites. Tes réponses déjà partagées sont enregistrées pour Sonny. Il préparera son retour personnel sous 7 jours.';

export class InterviewError extends Error { constructor(code, status=400) { super(code); this.code=code; this.status=status; } }
export const digest = value => createHash('sha256').update(value).digest('hex');
export function secret(env=process.env) { const key=env.ES2_ENTRETIEN_TOKEN_SECRET || env.SUPABASE_SERVICE_ROLE_KEY; if(!key)throw new InterviewError('configuration',503); return key; }
export function makeToken(id, key) { return `ei1.${id}.${createHmac('sha256',key).update(`es2-interview:v1:${id}`).digest('base64url')}`; }
export function jobSignature(id, jobId, key) { return createHmac('sha256',key).update(`es2-interview-worker:v1:${id}:${jobId}`).digest('hex'); }
export function validSignature(value,expected) { return typeof value==='string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value,'hex'),Buffer.from(expected,'hex')); }
export function normalizeEmail(value) { const email=String(value||'').trim().toLowerCase(); if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new InterviewError('email_invalid');return email; }
export function invitation(email,firstName,key) { const id=randomUUID();return {id,email:normalizeEmail(email),first_name:String(firstName||'').trim().slice(0,100),token_hash:digest(makeToken(id,key)),status:'invited',messages:[],summary:null,job:null,version:0}; }
export function publicSession(row) { if(row.job?.attempts>=3&&['queued','processing'].includes(row.job.status)&&Date.parse(row.job.lease_until)<Date.now())row={...row,job:{...row.job,status:'failed',error:'retry_exhausted'}}; return {id:row.id,firstName:row.first_name,status:row.status,version:row.version,messages:row.messages.map(({role,text,requestId})=>({role,text,requestId})),job:row.job?{id:row.job.id,type:row.job.type,status:row.job.status,retryable:row.job.attempts<3&&(row.job.status==='failed'||(['queued','processing'].includes(row.job.status)&&Date.parse(row.job.lease_until)<Date.now())),error:row.job.error||null}:null,completionReason:row.job?.closure_reason||null,question:questionUI(row),preview:row.job?.type==='reply'&&row.job?.status==='processing'?row.job.preview||'':''}; }
export function busy(row) { return row.job && ['queued','processing'].includes(row.job.status); }
// Each command is applied by one conditional UPDATE on (id, version). No read/modify/write without CAS.
export function planCommand(row, body, now=new Date().toISOString()) {
 if(row.status==='revoked')throw new InterviewError('invalid_link',401);
 const {action}=body;
 if(action==='start') {
  if(row.status==='active'&&!busy(row)&&row.messages.filter(m=>m.role==='user').length>=MAX_TURNS){
   return {status:'completed',completed_at:now,messages:[...row.messages,{role:'assistant',text:LIMIT_CLOSING}],job:{id:randomUUID(),type:'summary',status:'queued',attempts:0,error:null,closure_reason:'limit',lease_until:new Date(Date.parse(now)+LEASE_MS).toISOString()}};
  }
  if(row.status!=='invited')return null;
  return {status:'active',started_at:now,messages:[{role:'assistant',text:GREETING,interview:{guide_version:GUIDE_VERSION,coverage:blankCoverage(),next_area:'context'}}]};
 }
 if(action==='retry') {
  if(!row.job||body.requestId!==row.job.id)throw new InterviewError('no_pending_request',409);
  if(row.job.status==='done')return null;
  if(row.job.status==='processing'&&Date.parse(row.job.lease_until)>Date.parse(now))return null;
  if(row.job.status==='queued'&&Date.parse(row.job.lease_until)>Date.parse(now))return null;
  if(row.job.attempts>=3)throw new InterviewError('retry_exhausted',429);
  return {job:{...row.job,status:'queued',error:null,lease_until:new Date(Date.parse(now)+LEASE_MS).toISOString()}};
 }
 if(!['message','finish'].includes(action))throw new InterviewError('invalid_action');
 if(!UUID_RE.test(body.requestId||''))throw new InterviewError('request_id_required');
 // Replay of an acknowledged command returns existing state, never charges twice.
 const existing=row.messages.find(m=>m.requestId===body.requestId);
 if(existing) {
  if(action!=='message'||existing.text!==String(body.text||'').trim())throw new InterviewError('request_conflict',409);
  return null;
 }
 if(row.job?.id===body.requestId) {
  if(action==='finish'&&row.job.type==='summary')return null;
  throw new InterviewError('request_conflict',409);
 }
 if(row.status==='completed')throw new InterviewError('completed',409);
 if(row.status!=='active')throw new InterviewError('not_started',409);
 if(busy(row)&&!(action==='finish'&&row.job.attempts>=3&&Date.parse(row.job.lease_until)<Date.parse(now)))throw new InterviewError('busy',409);
 if(body.version!==row.version)throw new InterviewError('stale_version',409);
 if(row.job?.status==='failed'&&action==='message')throw new InterviewError('retry_required',409);
 const job={id:body.requestId,type:action==='finish'?'summary':'reply',status:'queued',attempts:0,error:null,lease_until:new Date(Date.parse(now)+LEASE_MS).toISOString()};
 if(action==='finish')return {status:'completed',completed_at:now,job:{...job,closure_reason:'student'},messages:[...row.messages,{role:'assistant',text:STOP_CLOSING}]};
 const text=String(body.text||'').trim();
 if(!text||text.length>MAX_TEXT)throw new InterviewError('message_length');
 if(row.messages.filter(m=>m.role==='user').length>=MAX_TURNS||row.messages.reduce((s,m)=>s+m.text.length,0)+text.length>100000)throw new InterviewError('session_limit',409);
 const selections=Array.isArray(body.selections)?body.selections.filter(s=>typeof s==='string').slice(0,8):[];
 const selectionOnly=body.selectionOnly===true&&text===selections.join('\n');
 const messages=[...row.messages,{role:'user',text,requestId:body.requestId,...(selections.length?{selections,selectionOnly}:{})}];
 const immediate=instantReply({...row,messages});
 if(immediate){
  const reason=closingReason({...row,messages},immediate);
  if(reason)return {status:'completed',completed_at:now,job:{...job,type:'summary',closure_reason:reason},messages:[...messages,{role:'assistant',text:CLOSING,interview:{...immediate,next_area:'closing',reason}}]};
  return {job:null,messages:[...messages,{role:'assistant',text:immediate.reply,interview:immediate}]};
 }
 return {job,messages};
}
