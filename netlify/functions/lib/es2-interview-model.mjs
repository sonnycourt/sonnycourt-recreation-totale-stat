import {INTERVIEW_SYSTEM,SUMMARY_SYSTEM,REPLY_SCHEMA,SUMMARY_SCHEMA} from './es2-interview-prompts.mjs';
import {guideControl,validReply,normalizeReply} from './es2-interview-guide.mjs';
import {InterviewError} from './es2-interview-domain.mjs';
export const DEFAULT_MODEL='claude-fable-5-1';
// Read just the visible JSON string, including partial escaped/unicode strings. No control metadata is exposed.
export function partialReply(text){
 const match=/"reply"\s*:\s*"/.exec(text);if(!match)return '';
 let result='',i=match.index+match[0].length;
 while(i<text.length){const c=text[i++];if(c==='"')break;if(c!=='\\'){result+=c;continue;}if(i>=text.length)break;const e=text[i++];if(e==='u'){const hex=text.slice(i,i+4);if(!/^[a-f\d]{4}$/i.test(hex))break;result+=String.fromCharCode(parseInt(hex,16));i+=4;}else{const escapes={'n':'\n','r':'\r','t':'\t','b':'\b','f':'\f','"':'"','\\':'\\','/':'/'};if(!(e in escapes))break;result+=escapes[e];}}
 return result.slice(0,2500);
}
export function validSummary(parsed,row){
 if(!parsed||typeof parsed.overview!=='string'||!Array.isArray(parsed.sections)||!Array.isArray(parsed.response_angles)||!Array.isArray(parsed.uncertainties)||typeof parsed.priority_question!=='string')return false;
 const ids=new Set(row.messages.filter(m=>m.role==='user').map((_,i)=>`u${i+1}`)),kinds=new Set(['reported','participant_interpretation','uncertain_hypothesis','not_discussed']);
 if(parsed.sections.some(s=>typeof s.title!=='string'||!Array.isArray(s.observations)||s.observations.some(o=>typeof o.text!=='string'||!kinds.has(o.kind)||!Array.isArray(o.source_ids)||o.source_ids.some(id=>!ids.has(id))||(o.kind!=='not_discussed'&&!o.source_ids.length))))return false;
 const arr=a=>Array.isArray(a)&&a.length<=12&&a.every(s=>typeof s==='string'&&s.length<=2500);
 const str=s=>typeof s==='string'&&s.length<=8000;
 const r=parsed.report;
 if(r&&(r.title?.length>180||r.introduction?.length>1000||r.situation?.length>2000||r.vision?.length>1600||r.day?.some(d=>d.current?.length>700||d.proposal?.length>900||d.minimum?.length>300)))return false;
 return [parsed.response_angles,parsed.uncertainties,...['present','history','desires','tensions','strengths','daily_life'].map(k=>parsed.map?.[k])].every(arr)&&str(parsed.email?.subject)&&str(parsed.email?.body)&&r&&['title','introduction','situation','vision','closing'].every(k=>str(r[k]))&&arr(r.understanding)&&arr(r.strengths)&&Array.isArray(r.day)&&r.day.length===3&&r.day.every(d=>['moment','current','proposal','minimum'].every(k=>str(d[k])))&&Array.isArray(r.roadmap)&&r.roadmap.length===3&&r.roadmap.every(w=>['period','focus','checkpoint'].every(k=>str(w[k]))&&arr(w.actions));
}
export async function generate(row,{fetchImpl=fetch,env=process.env,onPreview}={}){
 const summary=row.job.type==='summary',key=env.ANTHROPIC_API_KEY_ES2_ENTRETIEN||env.ANTHROPIC_API_KEY;if(!key)throw new InterviewError('model_not_ready',503);
 let n=0;const transcript=row.messages.map(m=>({role:m.role,id:m.role==='user'?`u${++n}`:null,text:m.text}));
 const content=JSON.stringify({first_name:row.first_name,transcript,...(summary?{closure_reason:row.job.closure_reason,sonny_response:row.summary?.human_email||null}:{control:guideControl(row)})});
 const stream=!summary&&!!onPreview;
 const response=await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:env.ES2_ENTRETIEN_MODEL||DEFAULT_MODEL,max_tokens:summary?12000:1700,stream,system:summary?SUMMARY_SYSTEM:INTERVIEW_SYSTEM,messages:[{role:'user',content}],output_config:{effort:summary?'high':'low',format:{type:'json_schema',schema:summary?SUMMARY_SCHEMA:REPLY_SCHEMA}}}),signal:AbortSignal.timeout(summary?180000:90000)});
 if(!response.ok)throw new InterviewError(response.status===429?'model_busy':'model_unavailable',503);
 let data,text='',stop=null,model=env.ES2_ENTRETIEN_MODEL||DEFAULT_MODEL;
 if(stream&&response.headers.get('content-type')?.includes('text/event-stream')){
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',lastPublish=0;
  while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let boundary;
   while((boundary=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const raw=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!raw)continue;const e=JSON.parse(raw);
    if(e.type==='error')throw new InterviewError('model_unavailable',503);
    if(e.type==='message_start')model=e.message.model||model;
    if(e.type==='content_block_delta'&&e.delta?.type==='text_delta'){text+=e.delta.text;const preview=partialReply(text);if(preview&&Date.now()-lastPublish>650){await onPreview(preview);lastPublish=Date.now();}}
    if(e.type==='message_delta'&&e.delta?.stop_reason)stop=e.delta.stop_reason;
   }
  }
 }else{data=await response.json();text=data.content?.filter(b=>b.type==='text').map(b=>b.text).join('')||'';stop=data.stop_reason;model=data.model||model;}
 if(stop!=='end_turn')throw new InterviewError('model_incomplete',503);
 let parsed;try{parsed=JSON.parse(text);}catch{throw new InterviewError('model_invalid',503);}
 if(summary){if(!validSummary(parsed,row))throw new InterviewError('model_invalid',503);if(row.summary?.human_email){parsed.email.body=row.summary.human_email;parsed.email.subject=row.summary.human_subject||parsed.email.subject;}}
 else {if(!validReply(parsed,row))throw new InterviewError('model_invalid',503);parsed=normalizeReply(parsed,row);}
 return {value:parsed,model};
}
