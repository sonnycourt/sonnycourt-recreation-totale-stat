const endpoint='/.netlify/functions/es2-entretien';
const start=document.getElementById('es-start');
const intro=document.querySelector('#es2-accueil .es-content');
const chat=document.getElementById('es-conversation');
const accessStatus=document.getElementById('es-access-status');
const tokenPattern=/^ei1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;
let token='',session=null,sending=false,poll=null,pending=null;
const revealedMessages=new Set();
const activeReveals=new Set();
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
// Only new assistant messages are revealed. Saved history stays immediately readable.
function messageText(message,index){
 const container=element('div','es-message-text');
 const key=`${session.id}:${index}`;
 const animate=message.role==='assistant'&&!revealedMessages.has(key)&&!reducedMotion.matches&&!document.hidden;
 revealedMessages.add(key);
 if(!animate){container.textContent=message.text;return container;}
 const visible=element('span','es-writing');visible.setAttribute('aria-hidden','true');
 const accessible=element('span','es-sr-only',message.text);
 container.append(visible,accessible);
 const chars=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('fr',{granularity:'grapheme'}).segment(message.text)].map(part=>part.segment):Array.from(message.text);
 const duration=Math.min(9000,Math.max(650,chars.length*14));
 let frame,started,lastCount=0;
 const finish=()=>{cancelAnimationFrame(frame);visible.textContent=message.text;visible.classList.remove('es-writing');activeReveals.delete(finish);};
 activeReveals.add(finish);
 const step=now=>{
  if(started===undefined)started=now;
  const count=Math.min(chars.length,Math.max(1,Math.floor((now-started)/duration*chars.length)));
  if(count!==lastCount){visible.textContent=chars.slice(0,count).join('');lastCount=count;}
  if(count>=chars.length||reducedMotion.matches||document.hidden){finish();return;}
  frame=requestAnimationFrame(step);
 };
 frame=requestAnimationFrame(step);
 return container;
}
function finishReveals(){for(const finish of [...activeReveals])finish();}
function sendIcon(){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
 const path=document.createElementNS(svg.namespaceURI,'path');
 path.setAttribute('d','M22 2 9 15 M22 2 14 22 9 15 2 10 22 2');svg.append(path);return svg;
}
const locationURL=new URL(location.href);
const candidate=new URLSearchParams(locationURL.hash.slice(1)).get('t')||locationURL.searchParams.get('t');
try{token=candidate||sessionStorage.getItem('es2-interview-token')||'';if(candidate&&tokenPattern.test(candidate))sessionStorage.setItem('es2-interview-token',candidate);}catch{token=candidate||'';}
// The invitation uses a fragment, so its credential never reaches CDN logs or Referer.
if(candidate){locationURL.hash='';locationURL.searchParams.delete('t');history.replaceState(null,'',locationURL.pathname+locationURL.search);}
const texts={invalid_link:'Ouvre le lien personnel reçu dans ton email pour accéder à ton entretien.',storage_not_ready:'L’entretien est en cours de préparation. Réessaie un peu plus tard.',model_not_ready:'L’assistante est en cours de préparation. Réessaie un peu plus tard.',configuration:'L’entretien est momentanément indisponible.',busy:'Une réponse est déjà en préparation. Patiente quelques instants.',stale_version:'La conversation a été mise à jour dans un autre onglet. Relis le dernier message avant d’envoyer ta réponse.',completed:'Cet entretien est terminé. Sonny dispose de tes réponses.',session_limit:'Nous avons suffisamment échangé pour ce bilan. Tu peux maintenant terminer l’entretien pour Sonny.',retry_exhausted:'L’assistante ne parvient pas à répondre pour le moment. Tes messages sont enregistrés. Tu peux terminer l’entretien pour Sonny.',message_length:'Écris un message entre 1 et 4 000 caractères.',retry_required:'Relance d’abord la réponse en attente.',network:'La connexion a été interrompue. Tes messages déjà envoyés sont conservés. Réessaie.'};
function explain(code){return texts[code]||'L’assistante est momentanément indisponible. Tes messages déjà envoyés restent enregistrés.';}
async function api(body){let response;try{response=await fetch(endpoint,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});}catch{throw Object.assign(new Error('network'),{code:'network'});}
 const result=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(result.error),{code:result.error});return result;
}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function showError(code){const target=document.getElementById('es-chat-status')||accessStatus;target.textContent=explain(code);target.classList.add('es-chat-error');}
function setBusy(value){sending=value;const send=document.getElementById('es-send');if(send)send.disabled=value||!document.getElementById('es-answer').value.trim();const finish=document.getElementById('es-finish');if(finish)finish.disabled=value;const skip=document.getElementById('es-skip');if(skip)skip.disabled=value;}
function render(){
 finishReveals();
 const oldDraft=document.getElementById('es-answer')?.value||'';
 intro.hidden=true;chat.hidden=false;chat.replaceChildren();
 const header=element('div','es-chat-head'),identity=element('div');identity.append(element('strong','','L’assistante IA de Sonny'),element('small','','Tes réponses sont enregistrées pour Sonny. Il te répondra personnellement.'));header.append(identity);
 if(session.status==='active'){const finish=element('button','es-chat-button','Terminer l’entretien');finish.type='button';finish.id='es-finish';finish.disabled=!!session.job&&['queued','processing'].includes(session.job.status);finish.onclick=()=>{
   if(document.getElementById('es-close-confirm'))return;
   const box=element('div','es-composer');box.id='es-close-confirm';box.append(element('p','','Terminer cet entretien pour Sonny ? Tu pourras le relire, mais tu ne pourras plus y ajouter de messages.'));
   const actions=element('div','es-composer-actions'),cancel=element('button','es-chat-button','Continuer à discuter'),confirm=element('button','es-start','Oui, terminer');
   cancel.type=confirm.type='button';cancel.onclick=()=>box.remove();confirm.onclick=()=>command('finish');actions.append(cancel,confirm);box.append(actions);header.after(box);confirm.focus();
  };header.append(finish);}chat.append(header);
 const log=element('div');log.setAttribute('role','log');log.setAttribute('aria-label','Conversation enregistrée');
 for(const [index,message] of session.messages.entries()){const item=element('article','es-message'+(message.role==='user'?' es-message-user':''));item.append(element('div','es-message-label',message.role==='user'?'Toi':'Assistante IA'),messageText(message,index));log.append(item);}chat.append(log);
 const status=element('p','es-chat-status');status.id='es-chat-status';status.setAttribute('role','status');chat.append(status);
 const job=session.job;const busy=job&&['queued','processing'].includes(job.status);
 if(session.status==='completed'){
  const completed=element('div','es-completed');completed.setAttribute('role','region');completed.setAttribute('aria-label','Fin de ton entretien');
  if(session.completionReason!=='safety'){const check=element('span','es-completed-check','✓');check.setAttribute('aria-hidden','true');completed.append(check);}
  completed.append(element('h2','',session.completionReason==='safety'?'L’entretien est arrêté':'Ton point personnel est terminé'),element('p','',session.completionReason==='safety'?'Cet espace n’est pas suivi en direct. N’attends pas le retour de Sonny pour demander une aide urgente.':'Merci d’avoir pris ce temps pour toi. Tes réponses sont enregistrées pour permettre à Sonny de préparer son retour personnel.'));
  chat.append(completed);status.textContent='Tu peux fermer cette page et revenir relire tes réponses avec ton lien personnel.';
 }
 else if(busy)status.textContent='L’assistante prend le temps de lire ta réponse… Tu peux revenir avec ton lien personnel si tu fermes la page.';
 if(job&&(job.status==='failed'||job.retryable)){
  if(session.status!=='completed')status.textContent='Ta réponse est enregistrée. L’assistante a rencontré une difficulté.';
  if(job.retryable){const retry=element('button','es-chat-button',job.type==='summary'?'Relancer la préparation pour Sonny':'Relancer la réponse');retry.type='button';retry.onclick=()=>command('retry');chat.append(retry);}
  else if(job.status==='failed'&&session.status!=='completed')status.textContent=explain('retry_exhausted');
 }
 if(session.status==='active'){
  const composer=element('div','es-composer'),area=element('textarea');area.id='es-answer';area.maxLength=4000;area.placeholder='Écris ton message…';area.setAttribute('aria-label','Ton message');area.value=oldDraft;area.disabled=!!busy||job?.status==='failed';composer.append(area);
  const actions=element('div','es-composer-actions');const skip=element('button','es-chat-button','Je préfère ne pas répondre');skip.id='es-skip';skip.type='button';skip.disabled=area.disabled;skip.onclick=()=>command('message','Je préfère ne pas répondre à cette question.');
  const send=element('button','es-start es-send-icon');send.append(sendIcon());send.setAttribute('aria-label','Envoyer le message');send.title='Envoyer le message';send.id='es-send';send.type='button';send.disabled=area.disabled||!area.value.trim();send.onclick=()=>command('message',area.value.trim());area.oninput=()=>{send.disabled=sending||!area.value.trim();};area.onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();if(!send.disabled)send.click();}};
  actions.append(skip,send);composer.append(actions);chat.append(composer);

 }
 if(busy)schedulePoll();
}
function schedulePoll(){clearTimeout(poll);poll=setTimeout(refresh,3000);}
async function refresh(){if(!session)return;try{const updated=await api();const changed=updated.version!==session.version||updated.job?.retryable!==session.job?.retryable;session=updated;if(changed)render();else if(session.job&&['queued','processing'].includes(session.job.status))schedulePoll();}catch{showError('network');poll=setTimeout(refresh,10000);}}
async function command(action,text=''){
 if(sending)return;setBusy(true);clearTimeout(poll);
 const same=pending?.action===action&&pending?.text===text;
 const requestId=action==='retry'?session.job.id:same?pending.requestId:crypto.randomUUID();
 const body={action,requestId,version:session.version,...(action==='message'?{text}:{})};pending={action,text,requestId};
 try{session=await api(body);pending=null;const area=document.getElementById('es-answer');if(area)area.value='';render();document.getElementById('es-chat-status')?.scrollIntoView({block:'nearest'});}
 catch(error){try{session=await api();render();}catch{}showError(error.code);}
 finally{sending=false;const area=document.getElementById('es-answer'),send=document.getElementById('es-send');if(send)send.disabled=!area.value.trim()||area.disabled;const finish=document.getElementById('es-finish');if(finish)finish.disabled=!!session.job&&['queued','processing'].includes(session.job.status);const skip=document.getElementById('es-skip');if(skip)skip.disabled=!!area?.disabled;}
}
start?.addEventListener('click',async()=>{if(!tokenPattern.test(token)){accessStatus.textContent=texts.invalid_link;return;}start.disabled=true;accessStatus.textContent='Ouverture de ton entretien…';try{session=await api({action:'start'});if(session.messages.length>1)session.messages.forEach((_,index)=>revealedMessages.add(`${session.id}:${index}`));accessStatus.textContent='';render();chat.scrollIntoView({block:'start'});}catch(error){accessStatus.textContent=explain(error.code);}finally{start.disabled=false;}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(poll);finishReveals();}else if(session)refresh();});
window.addEventListener('online',()=>{if(session)refresh();});

reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)finishReveals();});
