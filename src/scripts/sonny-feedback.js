import { normalizeEmail, validEmail } from '../../netlify/functions/lib/sonny-feedback.mjs';
import { demoSonnyReply } from './sonny-feedback-view.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo = new URLSearchParams(location.search).get('demo') === '1';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const state = {items:[],total:0,current:null,dirty:false,saving:false,loading:false,listSeq:0,detailSeq:0,matchSeq:0,pending:null};
const demoItems = [structuredClone(demoSonnyReply),{id:null,feedback_id:2,email:'demo2@example.com',prenom:'Alex Bernard',question:'Comment retrouver le calme quand je commence à douter de mon projet ?\n\nJe pratique plusieurs fois par semaine, mais les journées chargées me font perdre mon rythme.',answer:'',answered_on:null,version:0,received_at:'2026-10-31T09:00:00Z'}];
function message(text=''){ $('global-message').textContent=text; $('global-message').hidden=!text; }
function canLeave(){return !state.saving && (!state.dirty || confirm('Ton retour n’est pas enregistré. Quitter sans le sauvegarder ?'));}
function markDirty(){state.dirty=true;$('save-result').textContent='Modifications non enregistrées.';$('save-result').classList.remove('error');}
window.addEventListener('beforeunload',e=>{if(state.dirty || state.saving){e.preventDefault();e.returnValue='';}});
async function api(query='',body){
  const res=await fetch(`/.netlify/functions/sonny-feedback${query}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'x-sonny-feedback':'1',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const data=await res.json();if(!res.ok)throw Object.assign(Error(data.error || 'Connexion impossible.'),{status:res.status});return data;
}
function renderList(){
  $('count').textContent=state.total;
  $('inbox').innerHTML=state.items.length?state.items.map((item,i)=>`<div role="listitem"><button class="person feedback-person ${state.current && (item.reply_id===state.current.id || item.feedback_id && item.feedback_id===state.current.feedback_id)?'selected':''}" data-index="${i}"><strong>${esc(item.prenom || 'Sans prénom')}</strong><small>${esc(item.email)}</small><small class="${item.answered?'answered':''}">${item.answered?'Retour enregistré · '+esc(item.answered_on):'À traiter'}</small></button></div>`).join(''):'<p class="empty small">Aucune demande dans cette sélection.</p>';
  $('load-more').hidden=state.items.length>=state.total;
}
async function loadList(append=false){
  const seq=++state.listSeq;state.loading=true;
  try{
    const filter=$('filter').value,search=$('search').value.trim(),offset=append?state.items.length:0;
    let result;
    if(demo){
      const rows=demoItems.map(r=>({feedback_id:r.feedback_id,reply_id:r.id,email:r.email,prenom:r.prenom,answered:!!r.version,answered_on:r.answered_on}));
      const filtered=rows.filter(r=>(filter==='all'||(filter==='pending'?!r.answered:r.answered))&&`${r.email} ${r.prenom}`.toLowerCase().includes(search.toLowerCase()));
      result={items:filtered.slice(offset,offset+50),total:filtered.length,pending:rows.filter(r=>!r.answered).length};
    }else result=await api('?'+new URLSearchParams({filter,search,offset:String(offset)}));
    if(seq!==state.listSeq)return;
    state.items=append?[...state.items,...result.items]:result.items;state.total=result.total;
    $('pending-count').textContent=`${result.pending} à traiter`;renderList();message();
  }finally{if(seq===state.listSeq)state.loading=false;}
}
function draft(){const data=new FormData($('reply-form'));return {...state.current,email:normalizeEmail(data.get('email')),prenom:String(data.get('prenom')).trim(),question:String(data.get('question')).trim(),answer:String(data.get('answer')).trim(),answered_on:String(data.get('answered_on'))};}
async function matchEmail(){
  const seq=++state.matchSeq,form=$('reply-form');if(!form)return;
  const email=normalizeEmail(form.elements.email.value),target=$('match');
  if(!validEmail(email)){target.textContent='Renseigne l’adresse utilisée par l’élève dans le CRM.';target.className='match warning';return;}
  target.textContent='Recherche de la fiche CRM…';
  try{
    const data=demo?{matches:/^demo[12]@example\.com$/.test(email)?[{id:`00000000-0000-4000-8000-${email.startsWith('demo1')?'000000000001':'000000000002'}`,display_name:email.startsWith('demo1')?'Camille Martin':'Alex Bernard'}]:[]}:await api('?'+new URLSearchParams({view:'match',email}));
    if(seq!==state.matchSeq || form!==$('reply-form'))return;
    target.className='match'+(data.matches.length===1?'':' warning');
    target.replaceChildren();
    if(data.matches.length===1){target.append(`Fiche liée : ${data.matches[0].display_name || email}. `);const a=document.createElement('a');a.textContent='Voir dans le CRM ↗';a.href='/onboarding/?'+new URLSearchParams({...(demo?{demo:'1'}:{}),case:data.matches[0].id});a.target='_blank';a.rel='noopener';target.append(a);}
    else target.textContent=data.matches.length?'Plusieurs fiches correspondent : vérifie l’identité avant d’enregistrer.':'Pas encore de fiche CRM pour cet email. Le retour sera conservé et apparaîtra lorsque la fiche avec cet email existera.';
  }catch{if(seq===state.matchSeq){target.className='match warning';target.textContent='Correspondance CRM indisponible. Vérifie soigneusement l’email avant d’enregistrer.';}}
}
function renderEditor(){
  const r=state.current;const locked=!!r.feedback_id || r.version>0;
  $('editor').innerHTML=`<form id="reply-form"><header><p class="eyebrow">${r.feedback_id?'DEMANDE REÇUE':'ÉCHANGE RÉTROSPECTIF'}</p><h2>${esc(r.prenom || 'Ajouter un ancien retour')}</h2><p class="editor-hint">Enregistrer partage ce retour avec le coach affecté à cette fiche. Aucun message n’est envoyé à l’élève.</p></header><div class="identity"><label>Email de l’élève<input name="email" type="email" required maxlength="254" value="${esc(r.email)}" ${locked?'readonly':''} /></label><label>Prénom / nom<input name="prenom" maxlength="150" value="${esc(r.prenom)}" /></label></div><div id="match" class="match" role="status"></div><label><span class="editor-toolbar"><span>Sa demande / son bilan</span></span><textarea name="question" rows="9" maxlength="100000" required placeholder="Colle la question ou l’échange reçu…">${esc(r.question)}</textarea></label><label>Mon retour<textarea name="answer" rows="11" maxlength="100000" required placeholder="Colle ici la réponse que tu lui as envoyée par email…">${esc(r.answer)}</textarea></label><div class="editor-footer"><label>Date de mon retour<input name="answered_on" type="date" value="${esc(r.answered_on || today())}" max="${today()}" required /></label><div class="save-actions"><button class="quiet" id="copy-draft" type="button">Copier le brouillon</button><button class="primary" id="save" type="submit">Enregistrer pour Romain</button></div></div><p id="save-result" class="save-result" role="status">${r.version?'Retour enregistré · version '+r.version:''}</p></form>`;
  const form=$('reply-form');form.addEventListener('input',markDirty);form.addEventListener('submit',save);
  let matchTimer;
  form.elements.email.addEventListener('input',()=>{clearTimeout(matchTimer);matchTimer=setTimeout(()=>{if(form===$('reply-form'))matchEmail();},350);});
  form.elements.email.addEventListener('change',matchEmail);
  $('copy-draft').addEventListener('click',async()=>{try{const d=draft();await navigator.clipboard.writeText(`${d.email}\n${d.answered_on}\n\nDEMANDE\n${d.question}\n\nRETOUR SONNY\n${d.answer}`);$('save-result').textContent='Brouillon copié.';}catch{$('save-result').textContent='Copie impossible. Tu peux sélectionner les textes manuellement.';}});
  matchEmail();
}
async function openItem(item){
  if(!canLeave())return;
  const seq=++state.detailSeq;$('editor').inert=true;
  try{
    const result=demo?{item:demoItems.find(r=>item.reply_id?r.id===item.reply_id:r.feedback_id===item.feedback_id)}:await api('?'+new URLSearchParams(item.reply_id?{id:item.reply_id}:{feedback_id:item.feedback_id}));
    if(seq!==state.detailSeq)return;
    state.current={...result.item,id:result.item.id || crypto.randomUUID()};state.pending=null;state.dirty=false;renderEditor();renderList();
    if(matchMedia('(max-width:650px)').matches)$('editor').scrollIntoView({behavior:'smooth'});
  }catch(e){message(e.message);}finally{if(seq===state.detailSeq)$('editor').inert=false;}
}
async function save(e){
  e.preventDefault();if(state.saving || !$('reply-form').reportValidity())return;
  const d=draft();const payload={id:d.id,feedback_id:d.feedback_id || null,version:d.version,email:d.email,prenom:d.prenom,question:d.question,answer:d.answer,answered_on:d.answered_on};
  if(!validEmail(payload.email))return message('Vérifie l’adresse email de l’élève.');
  const signature=JSON.stringify(payload),command_id=state.pending?.signature===signature?state.pending.id:crypto.randomUUID();state.pending={signature,id:command_id};
  state.saving=true;$('reply-form').inert=true;$('save-result').textContent='Enregistrement…';
  try{
    let data;
    if(demo){const item={...d,version:d.version+1};let index=demoItems.findIndex(r=>r.id===d.id || d.feedback_id && r.feedback_id===d.feedback_id);if(index<0)demoItems.push(item);else demoItems[index]=item;data={item};}
    else data=await api('',{...payload,command_id});
    state.current=data.item;state.dirty=false;state.pending=null;renderEditor();
    $('save-result').textContent=demo?'Enregistré dans cette démonstration uniquement. Rien n’a été envoyé.':`Retour enregistré pour ${data.item.email}. Visible dans le CRM dès qu’une fiche correspond à cet email. Aucun email envoyé.`;
    try{await loadList();}catch{message('Retour enregistré, mais la liste n’a pas pu être actualisée.');}
  }catch(error){$('save-result').textContent=error.message+' Ton brouillon est conservé.';$('save-result').classList.add('error');}
  finally{state.saving=false;if($('reply-form'))$('reply-form').inert=false;}
}
$('inbox').addEventListener('click',e=>{const b=e.target.closest('[data-index]');if(b)openItem(state.items[Number(b.dataset.index)]);});
$('add-history').addEventListener('click',()=>{if(!canLeave())return;++state.detailSeq;$('editor').inert=false;state.current={id:crypto.randomUUID(),feedback_id:null,email:'',prenom:'',question:'',answer:'',answered_on:today(),version:0};state.dirty=false;state.pending=null;renderEditor();$('reply-form').elements.email.focus();});
$('refresh').addEventListener('click',()=>loadList().catch(e=>message(e.message)));
$('load-more').addEventListener('click',()=>{if(!state.loading)loadList(true).catch(e=>message(e.message));});
$('filter').addEventListener('change',()=>loadList().catch(e=>message(e.message)));
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadList().catch(e=>message(e.message)),250);});
async function open(){await loadList();$('login-screen').hidden=true;$('feedback-screen').hidden=false;}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{const data=new FormData(form);const res=await fetch('/.netlify/functions/closer-login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')}),signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error('Connexion impossible : vérifie tes identifiants.');form.reset();await open();}catch(err){$('login-message').textContent=err.message;}finally{button.disabled=false;}});
$('logout').addEventListener('click',async()=>{if(!canLeave())return;try{if(!demo){const res=await fetch('/.netlify/functions/closer-logout',{method:'POST',credentials:'same-origin'});if(!res.ok)throw Error('Déconnexion impossible.');}state.dirty=false;location.assign('/retours-sonny/');}catch(e){message(e.message);}});
if(demo){$('demo-banner').hidden=false;$('crm-link').href='/onboarding/?demo=1';open().then(()=>openItem(state.items[0]));}
else open().catch(e=>{if(e.status!==401)$('login-message').textContent=e.message;});
setInterval(()=>{if(!$('feedback-screen').hidden&&!document.hidden&&!state.loading&&!state.saving)loadList().catch(e=>message(e.message));},60000);
