import {INTERVIEW_SYSTEM,SUMMARY_SYSTEM,REPLY_SCHEMA,SUMMARY_SCHEMA} from './es2-interview-prompts.mjs';
import {guideControl,validReply,normalizeReply} from './es2-interview-guide.mjs';
import {InterviewError} from './es2-interview-domain.mjs';
export const DEFAULT_MODEL='claude-fable-5-1';
export async function generate(row,{fetchImpl=fetch,env=process.env}={}){
 const summary=row.job.type==='summary';const key=env.ANTHROPIC_API_KEY_ES2_ENTRETIEN||env.ANTHROPIC_API_KEY;if(!key)throw new InterviewError('model_not_ready',503);
 let userIndex=0;
 let transcriptIndex=0;
 const transcript=row.messages.map(m=>({role:m.role,content:m.role==='user'?`[u${++transcriptIndex}]\n${m.text}`:m.text}));
 const messages=summary?[{role:'user',content:JSON.stringify(row.messages.map(m=>({role:m.role,id:m.role==='user'?`u${++userIndex}`:null,text:m.text})))}]:[{role:'user',content:'Conduis cet entretien pour recueillir ma situation.'},...transcript];
 const response=await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:env.ES2_ENTRETIEN_MODEL||DEFAULT_MODEL,max_tokens:summary?9000:6000,system:summary?SUMMARY_SYSTEM:`${INTERVIEW_SYSTEM}\nCONTRÔLE INTERNE DU SERVEUR (ne pas montrer à l’élève)\n${JSON.stringify(guideControl(row))}`,messages,output_config:{effort:'high',format:{type:'json_schema',schema:summary?SUMMARY_SCHEMA:REPLY_SCHEMA}}}),signal:AbortSignal.timeout(150000)});
 if(!response.ok)throw new InterviewError(response.status===429?'model_busy':'model_unavailable',503);
 const data=await response.json();if(data.stop_reason!=='end_turn')throw new InterviewError('model_incomplete',503);
 let parsed;try{parsed=JSON.parse(data.content.filter(b=>b.type==='text').map(b=>b.text).join(''));}catch{throw new InterviewError('model_invalid',503);}
 if(summary){if(typeof parsed.overview!=='string'||!Array.isArray(parsed.sections)||!Array.isArray(parsed.response_angles)||!Array.isArray(parsed.uncertainties)||typeof parsed.priority_question!=='string')throw new InterviewError('model_invalid',503);
  const sourceIds=new Set(row.messages.filter(m=>m.role==='user').map((_,i)=>`u${i+1}`));
  const kinds=new Set(['reported','participant_interpretation','uncertain_hypothesis','not_discussed']);
  if(parsed.sections.some(s=>typeof s.title!=='string'||!Array.isArray(s.observations)||s.observations.some(o=>typeof o.text!=='string'||!kinds.has(o.kind)||!Array.isArray(o.source_ids)||o.source_ids.some(id=>!sourceIds.has(id))))||[...parsed.response_angles,...parsed.uncertainties].some(s=>typeof s!=='string'))throw new InterviewError('model_invalid',503);
 }
 else {if(!validReply(parsed,row))throw new InterviewError('model_invalid',503);parsed=normalizeReply(parsed,row);}
 return {value:parsed,model:data.model||env.ES2_ENTRETIEN_MODEL||DEFAULT_MODEL};
}
