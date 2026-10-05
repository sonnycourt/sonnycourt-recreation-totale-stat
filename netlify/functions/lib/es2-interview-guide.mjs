// The server owns the route. The model may clarify the current topic once, never choose another route.
export const GUIDE_VERSION = 2;
export const MAX_INTERVIEW_TURNS = 20;
export const STEPS = [
 {id:'context',label:'Ta situation',question:'Qu’est-ce qui te pèse le plus dans ta vie en ce moment ?',choices:['Mes relations','Mon travail ou ma situation financière','Ma confiance en moi','Mes peurs et mes inquiétudes','Mon énergie et mon quotidien','Un manque de direction'],multiple:true,fast:true},
 {id:'wellbeing',label:'Ton état au quotidien',question:'Ces derniers temps, quels états décrivent le mieux tes journées habituelles ? Tu peux en choisir plusieurs.',choices:['Plutôt serein·e','Souvent inquiet·ète ou tendu·e','Triste ou découragé·e','Fatigué·e ou sans élan','Motivé·e et plein·e d’envies','Cela varie beaucoup selon les moments'],multiple:true,fast:true},
 {id:'context_detail',label:'Ce que tu vis',question:'Raconte-moi une situation récente qui illustre ce que tu traverses. Qu’est-ce qui a été le plus difficile pour toi à ce moment-là ?',clarify:true},
 {id:'childhood',label:'Ton histoire',question:'Si tu es à l’aise pour en parler, vois-tu un lien entre ce que tu vis aujourd’hui et ton enfance ou l’ambiance dans laquelle tu as grandi ? Tu peux aussi ne pas savoir ou préférer passer.',clarify:true},
 {id:'vision',label:'Tes aspirations',question:'Si tu pouvais faire évoluer ta vie dans le sens qui compte vraiment pour toi, qu’aimerais-tu vivre concrètement ?',clarify:true},
 {id:'resistance',label:'Ton regard sur l’avenir',question:'Quand tu penses à cette vie que tu désires, qu’est-ce qui décrit le mieux ce que tu ressens ?',choices:['Je sens que c’est possible pour moi','J’en ai envie, mais je doute de moi','Cela me semble très loin','Une partie de moi a peur que cela change','J’ai du mal à savoir ce que je ressens'],multiple:false,fast:true},
 {id:'resistance_detail',label:'Ce qui freine ou soutient ton élan',question:'Qu’est-ce qui te fait ressentir cela face à tes désirs aujourd’hui ?',clarify:true},
 {id:'history',label:'Les tournants de ta vie',question:'En dehors de ce que tu m’as déjà raconté, quel tournant de ta vie t’a le plus marqué : une période difficile, une réussite ou une rencontre ? Raconte-moi ce qu’il a changé pour toi.',clarify:true},
 {id:'resources',label:'Tes points d’appui',question:'Dans les périodes difficiles, qu’est-ce qui t’a déjà aidé à rebondir ? Tu peux choisir plusieurs réponses et préciser ce qui t’a fait du bien.',choices:['Une personne ou un entourage','Une décision ou une action concrète','Le mouvement ou la nature','La méditation, l’écriture ou une pratique personnelle','Un accompagnement professionnel','Je n’ai pas encore trouvé ce qui m’aide'],multiple:true,clarify:true},
 {id:'morning',label:'Ta journée réelle',question:'Pour terminer ce portrait, parcourons une journée habituelle. Du réveil jusqu’à midi, comment se passe-t-elle concrètement pour toi ? Pense à tes occupations et à la façon dont tu te sens.'},
 {id:'day',label:'Ta journée réelle',question:'Et de midi jusqu’à la fin de l’après-midi, comment se déroule généralement ta journée ?'},
 {id:'evening',label:'Ta journée réelle',question:'Enfin, à quoi ressemblent tes soirées jusqu’au coucher ? Tu peux situer ici tes moments pour toi, tes pratiques ou ES2 si tu ne les as pas déjà évoqués.'},
 {id:'priority',label:'Ta question pour Sonny',question:'Quelle question précise aimerais-tu que Sonny aborde en priorité dans sa réponse ? Tu peux aussi me dire que tu n’as rien à ajouter.'},
];
export const AREAS=STEPS.map(s=>s.id);
export const COVERAGE_STATUSES=['missing','covered','declined','unclear'];
export const DECISIONS=['continue','complete','stop_requested','safety_stop'];
export const SKIP_TEXT='Je préfère ne pas répondre à cette question.';
export const blankCoverage=()=>Object.fromEntries(AREAS.map(area=>[area,{status:'missing',source_ids:[]}]));
export const answerCount=row=>row.messages.filter(m=>m.role==='user').length;
export const allAddressed=coverage=>AREAS.every(area=>coverage[area]?.status&&coverage[area].status!=='missing');
export function lastGuide(row){return row.messages.findLast(m=>m.role==='assistant'&&m.interview?.guide_version===GUIDE_VERSION)?.interview||{guide_version:GUIDE_VERSION,coverage:blankCoverage(),next_area:'context'};}
export function guideControl(row){
 const previous=lastGuide(row),area=previous.next_area,index=Math.max(0,AREAS.indexOf(area)),step=STEPS[index];
 const asked=row.messages.filter(m=>m.role==='assistant'&&m.interview?.guide_version===GUIDE_VERSION&&m.interview.next_area===area).length;
 const latest=row.messages.at(-1)?.text||'';
 const skipped=latest===SKIP_TEXT||/^je (?:ne veux pas|ne souhaite pas|préfère ne pas) (?:parler|répondre|aborder)/iu.test(latest.trim());
 return {current_area:area,current_goal:step.question,next_area:AREAS[index+1]||'closing',next_question:STEPS[index+1]?.question||null,
  may_clarify:!!step.clarify&&asked<2&&!skipped,skipped,answers_received:answerCount(row),maximum_answers:MAX_INTERVIEW_TURNS,
  closing_required:area==='priority'||answerCount(row)>=MAX_INTERVIEW_TURNS,previous_coverage:previous.coverage};
}
export function questionUI(row){
 const guide=lastGuide(row),step=STEPS.find(s=>s.id===guide.next_area)||STEPS[0];
 const asked=row.messages.filter(m=>m.interview?.guide_version===GUIDE_VERSION&&m.interview.next_area===step.id).length;
 return {label:step.label,choices:asked<=1?step.choices||[]:[],multiple:!!step.multiple,progress:Math.round(AREAS.indexOf(step.id)/AREAS.length*100)};
}
export function validReply(v){return v&&typeof v.reply==='string'&&v.reply.trim()&&v.reply.length<=2500&&DECISIONS.includes(v.decision)&&[...AREAS,'closing'].includes(v.next_area);}
export function normalizeReply(value,row){
 const c=guideControl(row),coverage=structuredClone(c.previous_coverage||blankCoverage());
 const entry=coverage[c.current_area]||{status:'missing',source_ids:[]};
 coverage[c.current_area]={status:c.skipped?'declined':'covered',source_ids:[...new Set([...entry.source_ids,`u${answerCount(row)}`])]};
 let next=value.next_area,reply=value.reply,decision=value.decision;
 if(!['safety_stop','stop_requested'].includes(decision)){
  if(c.closing_required){next='closing';decision='complete';}
  else if(next!==c.next_area&&!(next===c.current_area&&c.may_clarify)){next=c.next_area;reply=c.next_question;decision='continue';}
  else decision='continue';
 }
 return {reply,decision,next_area:next,coverage,guide_version:GUIDE_VERSION};
}
export function closingReason(row,reply){if(reply.decision==='safety_stop')return 'safety';if(reply.decision==='stop_requested')return 'student';if(answerCount(row)>=MAX_INTERVIEW_TURNS)return 'limit';if(guideControl(row).current_area==='priority')return 'sufficient';return null;}
// A deliberate skip and the two closed-choice screens need no model call. Free text always goes to the model.
export function instantReply(row){
 const c=guideControl(row),last=row.messages.at(-1),step=STEPS.find(s=>s.id===c.current_area);
 const exactChoices=step?.fast&&last?.selectionOnly===true&&Array.isArray(last.selections)&&last.selections.length>0&&last.selections.every(s=>step.choices.includes(s));
 if(last?.text!==SKIP_TEXT&&!exactChoices)return null;
 return normalizeReply({reply:c.next_question||'Merci, tes réponses sont enregistrées pour Sonny.',decision:c.closing_required?'complete':'continue',next_area:c.next_area},row);
}
