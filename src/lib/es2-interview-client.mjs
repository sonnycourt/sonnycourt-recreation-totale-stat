const endpoint='/.netlify/functions/es2-entretien';
const start=document.getElementById('es-start'),intro=document.querySelector('#es2-accueil .es-content'),chat=document.getElementById('es-conversation'),accessStatus=document.getElementById('es-access-status');
const tokenPattern=/^ei1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;
let token='',session=null,sending=false,poll=null,pending=null,animation=null;
const revealed=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const url=new URL(location.href),candidate=new URLSearchParams(url.hash.slice(1)).get('t')||url.searchParams.get('t');
try{token=candidate||sessionStorage.getItem('es2-interview-token')||'';if(candidate&&tokenPattern.test(candidate))sessionStorage.setItem('es2-interview-token',candidate);}catch{token=candidate||'';}
if(candidate){url.hash='';url.searchParams.delete('t');history.replaceState(null,'',url.pathname+url.search);}
const errors={invalid_link:'Ouvre le lien personnel reçu dans ton email pour accéder à ton entretien.',busy:'Ta réponse est en cours de traitement.',stale_version:'L’entretien a été mis à jour dans un autre onglet. Relis la question avant de répondre.',completed:'Ton entretien est terminé et tes réponses sont enregistrées.',message_length:'Ta réponse doit contenir entre 1 et 4 000 caractères.',retry_exhausted:'Tes réponses sont conservées. Tu peux arrêter ici pour les transmettre à Sonny.',network:'La connexion a été interrompue. Tes réponses envoyées sont conservées. Réessaie dans un instant.'};
async function api(body){let r;try{r=await fetch(endpoint,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});}catch{throw {code:'network'};}const data=await r.json();if(!r.ok)throw {code:data.error};return data;}
const error=e=>{const target=document.getElementById('es-chat-status')||accessStatus;target.textContent=errors[e.code]||'L’assistante est momentanément indisponible. Tes réponses déjà envoyées restent enregistrées.';};
function icon(){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.innerHTML='<path d="M22 2 9 15m13-13-8 20-5-7-7-5L22 2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';return svg;}
function textReveal(node,text,key){
 if(revealed.has(key)||reduced.matches){node.textContent=text;return;}revealed.add(key);
 const chars=Array.from(text),duration=Math.min(900,Math.max(180,chars.length*2));let then;
 node.setAttribute('aria-label',text);const span=el('span');span.setAttribute('aria-hidden','true');node.append(span);
 const tick=now=>{then??=now;const n=Math.min(chars.length,Math.ceil((now-then)/duration*chars.length));span.textContent=chars.slice(0,n).join('');if(n<chars.length)animation=requestAnimationFrame(tick);else animation=null;};animation=requestAnimationFrame(tick);
}
function historyPanel(){const d=el('details','es-history');d.append(el('summary','','Relire mes réponses'));for(const m of session.messages){const item=el('div','es-history-item');item.append(el('small','',m.role==='user'?'Toi':'Assistante de Sonny'),el('p','',m.text));d.append(item);}return d;}
function render(){
 cancelAnimationFrame(animation);clearTimeout(poll);intro.hidden=true;chat.hidden=false;
 const draft=document.getElementById('es-answer')?.value||'',checked=[...chat.querySelectorAll('.es-option input:checked')].map(e=>e.value);
 chat.replaceChildren();const job=session.job,busy=!!job&&['queued','processing'].includes(job.status),complete=session.status==='completed';
 const header=el('div','es-chat-head'),identity=el('div');identity.append(el('span','es-interview-eyebrow','TON POINT PERSONNEL'),el('strong','','L’assistante IA de Sonny'),el('small','','Pour que Sonny comprenne vraiment ce que tu vis.'));header.append(identity);
 if(!complete){const finish=el('button','es-chat-button','Arrêter ici');finish.id='es-finish';finish.type='button';finish.disabled=busy||sending;finish.onclick=()=>{if(document.getElementById('es-close-confirm'))return;const box=el('div','es-close-confirm');box.id='es-close-confirm';box.append(el('p','','Transmettre tes réponses maintenant ? Tu pourras les relire, mais tu ne pourras plus compléter cet entretien.'));const cancel=el('button','es-chat-button','Continuer'),confirm=el('button','es-start','Terminer et transmettre');cancel.onclick=()=>box.remove();confirm.onclick=()=>command('finish');box.append(cancel,confirm);header.after(box);confirm.focus();};header.append(finish);}chat.append(header);
 if(!complete){const bar=el('div','es-progress'),fill=el('span');fill.style.width=Math.max(3,session.question?.progress||0)+'%';bar.setAttribute('aria-hidden','true');bar.append(fill);chat.append(bar);}
 if(complete){
  const box=el('div','es-completed');
  if(session.completionReason==='safety'){box.append(el('h2','','L’entretien est arrêté'),el('p','','Cet espace n’est pas suivi en direct. N’attends pas la réponse de Sonny pour demander une aide urgente.'),el('p','',session.messages.at(-1)?.text||''));}
  else{box.append(el('div','es-completed-seal','✓'),el('span','es-interview-eyebrow','UNE ÉTAPE POUR TOI'),el('h2','','Tu as posé les bases de ton accompagnement personnel.'),el('p','','Ce que tu as choisi de partager est enregistré pour Sonny. Il pourra s’appuyer sur ton récit pour préparer une réponse adaptée à ta situation.'));
   const map=el('div','es-finish-map');for(const label of ['Ce que tu vis','Ton histoire','Tes aspirations','Tes points d’appui','Ton quotidien','Ta question'])map.append(el('span','',label));box.append(map,el('div','es-response-delay','Une réponse personnelle de Sonny sous 7 jours.'));}
  chat.append(box,historyPanel());
 }else{
  if(session.messages.length>1)chat.append(historyPanel());
  const card=el('section','es-question-card');card.setAttribute('aria-label','Question actuelle');
  card.append(el('div','es-question-label',busy?'L’assistante prépare la suite…':session.question?.label||'Ta situation'));
  const question=el('div','es-current-question');question.id='es-current-question';question.setAttribute('aria-live','polite');
  const last=session.messages.findLast(m=>m.role==='assistant');
  if(busy){if(session.preview)question.textContent=session.preview;else{question.append(el('span','es-thinking','•••'));question.setAttribute('aria-label','Réponse en préparation');}}
  else {let text=last?.text||'';if(session.messages.length===1&&text.includes('\n\n')){const parts=text.split('\n\n');card.append(el('p','es-question-welcome',parts.shift()));text=parts.join('\n\n');}textReveal(question,text,`${session.id}:${session.messages.length}`);}
  card.append(question);
  if(!busy){
   const choices=session.question?.choices||[];
   if(choices.length){const group=el('fieldset','es-choices');group.append(el('legend','es-choice-hint',session.question.multiple?'Choisis une ou plusieurs réponses.':'Choisis la réponse qui te correspond le mieux.'));
    for(const option of [...choices,'Autre']){const label=el('label','es-option'),input=el('input');input.type=session.question.multiple?'checkbox':'radio';input.name='es-choice';input.value=option;input.checked=checked.includes(option);label.append(input,el('span','',option));group.append(label);}card.append(group);}
   const area=el('textarea');area.id='es-answer';area.maxLength=4000;area.value=draft;area.rows=choices.length?2:5;area.placeholder=choices.length?'Une précision, si tu le souhaites…':'Quelques mots ou un exemple, comme cela te vient…';area.setAttribute('aria-label',choices.length?'Précision facultative':'Ta réponse');area.disabled=job?.status==='failed';card.append(area);
   const actions=el('div','es-composer-actions'),skip=el('button','es-chat-button','Je préfère passer'),send=el('button','es-start es-send-icon');skip.type=send.type='button';skip.id='es-skip';send.id='es-send';skip.disabled=area.disabled;send.append(icon());send.title='Envoyer ma réponse';send.setAttribute('aria-label','Envoyer ma réponse');
   const getSelections=()=>[...card.querySelectorAll('.es-option input:checked')].map(e=>e.value);
   const update=()=>{send.disabled=sending||area.disabled||(!area.value.trim()&&!getSelections().filter(s=>s!=='Autre').length);};card.onchange=area.oninput=update;
   send.onclick=()=>{const selections=getSelections().filter(s=>s!=='Autre'),free=area.value.trim(),text=[...selections,...(free?[free]:[])].join('\n');command('message',text,{selections,selectionOnly:!free});};
   skip.onclick=()=>command('message','Je préfère ne pas répondre à cette question.');area.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(!send.disabled)send.click();}};
   actions.append(skip,send);card.append(actions,el('small','es-question-note','Il n’y a pas de bonne réponse. Tu choisis ce que tu souhaites partager.'));update();
  }chat.append(card);
 }
 const status=el('p','es-chat-status');status.id='es-chat-status';status.setAttribute('role','status');chat.append(status);
 if(!complete&&job&&(job.status==='failed'||job.retryable)){status.textContent=job.retryable?'Ta réponse est enregistrée. Tu peux relancer la préparation de la question suivante.':errors.retry_exhausted;if(job.retryable){const retry=el('button','es-chat-button','Réessayer');retry.onclick=()=>command('retry');chat.append(retry);}}
 if(complete)status.textContent='Tu peux fermer cette page et revenir relire ton entretien avec ton lien personnel.';
 if(busy&&!complete)schedulePoll();
}
function schedulePoll(){clearTimeout(poll);poll=setTimeout(refresh,850);}
async function refresh(){if(!session||document.hidden)return;try{const updated=await api(),changed=updated.version!==session.version||updated.job?.retryable!==session.job?.retryable;session=updated;if(changed)render();else if(['queued','processing'].includes(session.job?.status))schedulePoll();}catch(e){error(e);poll=setTimeout(refresh,5000);}}
async function command(action,text='',extra={}){
 if(sending)return;sending=true;clearTimeout(poll);for(const b of chat.querySelectorAll('button'))b.disabled=true;
 const same=pending?.action===action&&pending?.text===text,requestId=action==='retry'?session.job.id:same?pending.requestId:crypto.randomUUID();
 pending={action,text,requestId};
 try{session=await api({action,text,...extra,requestId,version:session.version});pending=null;const area=document.getElementById('es-answer');if(area)area.value='';for(const input of chat.querySelectorAll('.es-option input'))input.checked=false;sending=false;render();document.getElementById('es-current-question')?.scrollIntoView({block:'nearest',behavior:'smooth'});}
 catch(e){sending=false;try{session=await api();}catch{}render();error(e);}
}
start?.addEventListener('click',async()=>{if(!tokenPattern.test(token)){accessStatus.textContent=errors.invalid_link;return;}start.disabled=true;accessStatus.textContent='Ouverture de ton espace personnel…';try{session=await api({action:'start'});accessStatus.textContent='';render();chat.scrollIntoView({block:'start'});}catch(e){error(e);}finally{start.disabled=false;}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(poll);else if(session)refresh();});window.addEventListener('online',()=>{if(session)refresh();});
