import { presentCase, CONTACT_LABELS, contactStep, validContactTime, formatRegistrationTime, contactTimer, firstSuccessfulContact } from '../../netlify/functions/lib/onboarding-domain.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const demo = new URLSearchParams(location.search).get('demo') === '1';
const statusLabels = { new:'Nouveau', contacting:'Contact en cours', awaiting:'En attente de réponse', contacted:'Contact établi', booked:'Onboarding planifié', done:'Accueil réalisé', paused:'En pause' };
const actionLabels = { call:'Appeler', sms:'Envoyer le SMS', whatsapp:'WhatsApp vocal, si toujours sans réponse', followup:'Prévoir la suite', onboarding:'Planifier / réaliser l’onboarding', none:'Aucune relance prévue' };
const kindLabels = { ...CONTACT_LABELS, updated:'Fiche mise à jour', contacted:'Contact établi / réponse reçue' };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const state = { cases:[], total:0, selected:null, current:null, dirty:false, saving:false, pending:null, listSeq:0, detailSeq:0, loading:false, detailLoading:false, events:[], modalDirty:false };
const timerNow=()=>state.serverClock?state.serverClock.ms+performance.now()-state.serverClock.tick:Date.now();
const fmtDate = (v) => v ? new Intl.DateTimeFormat('fr-FR', { timeZone:'Europe/Paris', day:'numeric', month:'short', year:'numeric' }).format(new Date(v.length === 10 ? `${v}T12:00:00Z` : v)) : 'À renseigner';
const fmtTime = (v) => v ? new Intl.DateTimeFormat('fr-FR', { dateStyle:'short', timeStyle:'short', timeZone:zone }).format(new Date(v)) : '';
const datetime = (v) => { if (!v) return ''; const d=new Date(v); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const initials = (name) => name.trim().split(/\s+/).slice(0,2).map((w)=>w[0]).join('').toUpperCase();
const countryNames = new Intl.DisplayNames(['fr'], { type:'region' });
function country(value) { if (!value || ['OTHER','Autre'].includes(value)) return 'Pays non précisé'; try { return /^[A-Z]{2}$/.test(value) ? countryNames.of(value) : value; } catch { return value; } }
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>{$('toast').hidden=true;},4500); }
function message(text='') { $('global-message').textContent=text; $('global-message').hidden=!text; }
function canLeave() { return !state.saving && (!state.dirty || confirm('Des modifications ne sont pas enregistrées. Quitter cette fiche sans les sauvegarder ?')); }
function setDirty() { state.dirty=true; const flag=$('save-state'); if(flag){flag.textContent='Modifications non enregistrées';flag.className='unsaved';} }
window.addEventListener('beforeunload',(e)=>{if(state.dirty || state.modalDirty || state.saving){e.preventDefault();e.returnValue='';}});

async function api(path='',body) {
  const res=await fetch(`/.netlify/functions/onboarding-crm${path}`,{
    method:body?'POST':'GET', credentials:'same-origin', cache:'no-store',
    headers:{'x-onboarding-client':'1',...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(40000),
  });
  const data=await res.json();
  if(Number.isFinite(Date.parse(data.serverNow)))state.serverClock={ms:Date.parse(data.serverNow),tick:performance.now()};
  if(!res.ok){const error=new Error(data.error || 'Connexion impossible. Réessaie.');error.status=res.status;throw error;}
  return data;
}

// Démonstration volontairement fictive, locale et éphémère. Aucun client réel.
const demoCases = ['Camille Martin','Alex Bernard','Sarah Laurent','Noa Petit'].map((name,i)=>presentCase({
  id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`, display_name:name,
  email:`demo${i+1}@example.com`,phone:'',country:['FR','CA','BE','MA'][i],city:['Lyon','Montréal','Bruxelles','Casablanca'][i],
  source:'mc2', purchased_at:new Date(Date.now()-(i+1)*86400000).toISOString(),plan:'twelve',
  status:['new','awaiting','booked','done'][i],next_action:['call','whatsapp','onboarding','none'][i],
  followup_at:i===1?new Date(Date.now()-3600000).toISOString():null,
  onboarding_at:i===2?new Date(Date.now()+86400000).toISOString():null,coaching_at:null,
  goal:i===1?'Prendre confiance pour lancer son projet.':'',motivations:'',obstacles:'',routine:'',notes:'',
  training_access:i>0,community_access:i>0,feedback_explained:i===3,coaching_booked:false,version:1,
}));
const demoEvents = new Map();
for(const i of [2,3])demoEvents.set(demoCases[i].id,[{id:crypto.randomUUID(),kind:i===2?'call_answered':'completed',note:'Échange fictif de démonstration.',occurred_at:new Date(Date.parse(demoCases[i].purchased_at)+(i===2?20:51)*3600000).toISOString(),can_delete:true}]);
const demoTimed=(c)=>({...c,contact_timing_known:true,first_successful_contact_at:firstSuccessfulContact(demoEvents.get(c.id)||[])});
function demoList() {
  const filter=$('filter').value, search=$('search').value.toLocaleLowerCase();
  const due=(c)=>!['done','paused'].includes(c.status)&&(c.status==='new'||(c.followup_at && Date.parse(c.followup_at)<=Date.now()));
  const rows=demoCases.filter((c)=>(filter==='all'||(filter==='due'?due(c):c.status===filter))&&`${c.name} ${c.email} ${c.country} ${country(c.country)} ${c.city}`.toLowerCase().includes(search));
  return { cases:rows.map(demoTimed),total:rows.length, counts:{all:demoCases.length,new:demoCases.filter(c=>c.status==='new').length,due:demoCases.filter(due).length,booked:demoCases.filter(c=>c.status==='booked').length,done:demoCases.filter(c=>c.status==='done').length},actor:{name:'Romain · démo',id:22},refreshedAt:new Date().toISOString() };
}

function renderClocks() {
  for(const node of document.querySelectorAll('[data-contact-clock]')){
    const row=state.current?.id===node.dataset.contactClock?state.current:state.cases.find(c=>c.id===node.dataset.contactClock);
    if(!row)continue;
    const timer=contactTimer(row,timerNow());node.dataset.timerState=timer.state;
    const content=node.dataset.clockDetail==='true'
      ?`<div><span class="clock-caption">PREMIER ÉCHANGE · OBJECTIF 48 H</span><p>${esc(timer.title)}</p><small>${esc(timer.detail)}</small></div><strong>${esc(timer.value)}</strong>`
      :esc(timer.compact);
    if(node.innerHTML!==content)node.innerHTML=content;
  }
}

function renderList() {
  $('total').textContent=`${state.total}`;
  $('case-list').innerHTML=state.cases.length?state.cases.map((c)=>`<div role="listitem"><button class="person ${c.id===state.selected?'selected':''}" data-case="${esc(c.id)}" aria-pressed="${c.id===state.selected}"><span class="person-top"><span class="avatar">${esc(initials(c.name))}</span><span><strong>${esc(c.name)}</strong><span class="place">${esc(country(c.country))}${c.city?' · '+esc(c.city):''}</span></span></span><span class="person-bottom"><span class="tag ${esc(c.status)}">${esc(statusLabels[c.status])}</span><small>${esc(fmtDate(c.purchased_at))}</small></span><span class="person-next">${esc(actionLabels[c.next_action])}${c.followup_at?' · '+esc(fmtTime(c.followup_at)):''}</span><span class="contact-clock-compact" data-contact-clock="${esc(c.id)}" aria-live="off"></span></button></div>`).join(''):'<p class="empty small">Aucun dossier dans cette sélection.</p>';
  $('load-more').hidden=state.cases.length>=state.total;
  renderClocks();
}
async function loadList(append=false) {
  const seq=++state.listSeq;state.loading=true;
  try {
    const offset=append?state.cases.length:0;
    const q=new URLSearchParams({ filter:$('filter').value,search:$('search').value.trim(),offset:String(offset) });
    const data=demo?demoList():await api(`?${q}`);
    if(seq!==state.listSeq)return;
    state.cases=append?[...state.cases,...data.cases]:data.cases;state.total=data.total;
    // Rafraîchir seulement le compteur de la fiche ouverte, jamais ses notes/brouillons.
    const fresh=state.cases.find(c=>c.id===state.current?.id);
    if(fresh&&fresh.version>=state.current.version){state.current.contact_timing_known=fresh.contact_timing_known;state.current.first_successful_contact_at=fresh.first_successful_contact_at;}
    $('actor-name').textContent=data.actor.name;
    for(const key of ['new','due','booked','done']) $(`count-${key}`).textContent=data.counts[key] ?? 0;
    $('sync-label').textContent=`À jour à ${new Date(data.refreshedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})} · actualisation 60 s`;
    message(data.syncWarning?'Les dossiers existants restent accessibles, mais les nouvelles arrivées n’ont pas pu être actualisées. Réessaie dans un instant.':'');
    renderList();
  } finally { if(seq===state.listSeq)state.loading=false; }
}

const options=(values,selected)=>Object.entries(values).map(([v,label])=>`<option value="${v}" ${v===selected?'selected':''}>${esc(label)}</option>`).join('');
function field(key,label,full=false) {return `<label class="${full?'full':''}">${label}<textarea name="${key}" maxlength="${key==='notes'?12000:4000}" rows="${key==='notes'?4:2}">${esc(state.current[key])}</textarea></label>`;}
function renderHistory() {
  $('history').innerHTML=state.events.length?state.events.map((e)=>`<li><div class="history-head"><span>${esc(kindLabels[e.kind]||e.kind)}</span><div class="history-tools"><time datetime="${esc(e.occurred_at)}">${esc(fmtTime(e.occurred_at))}</time>${e.can_delete && e.id?`<button class="quiet delete-event" type="button" data-delete-event="${esc(e.id)}" aria-label="Supprimer : ${esc(kindLabels[e.kind]||e.kind)}">Supprimer</button>`:''}</div></div>${e.note?`<p>${esc(e.note)}</p>`:''}</li>`).join(''):'<li class="small">Aucun contact noté pour le moment.</li>';
}
function renderDetail() {
  const c=state.current;
  const phone=(c.phone||'').replace(/[^+\d]/g,'');
  const waiting=c.followup_at && Date.parse(c.followup_at)>Date.now();
  const sms=`Hello ${c.name.split(' ')[0]}, c’est Romain, ton coach personnel dans Esprit Subconscient 2.0. Je viens de t’appeler pour te souhaiter la bienvenue ! Quand serais-tu disponible pour un échange de 15 à 20 minutes afin de bien démarrer ?`;
  $('detail').innerHTML=`
    <div class="detail-header"><button class="quiet mobile-back" id="back-list">← Revenir à la liste</button><p class="eyebrow">DOSSIER D’ACCUEIL</p><div class="detail-title"><h2>${esc(c.name)}</h2><span class="tag ${esc(c.status)}">${esc(statusLabels[c.status])}</span></div><div class="contact-line"><span>${esc(country(c.country))}${c.city?' · '+esc(c.city):''}</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${phone?`<span class="phone-number">${esc(c.phone)}</span>`:'<span>Téléphone non renseigné</span>'}</div>${c.special_instructions?`<p class="notice">${esc(c.special_instructions)}</p>`:''}</div>
    <section class="detail-section"><div class="section-heading"><h3>Les repères du parcours</h3><small>Dates et heures · Paris</small></div><div class="dates"><div class="date-item">Inscription à la formation<strong>${esc(formatRegistrationTime(c.purchased_at))}</strong></div><div class="date-item">${c.source==='legacy'?'Prochain versement prévu':'Premier versement prévu'}<strong>${esc(fmtDate(c.first_payment_date))}</strong><small>${esc(c.payment_date_source)}</small></div><div class="date-item">Premier coaching à partir du<strong>${esc(fmtDate(c.coaching_from))}</strong><small>J+33 · feedback personnel de Sonny à J+14, le ${esc(fmtDate(c.feedback_date))}.</small></div></div><p class="plan">${esc(c.plan_label)}. Les dates de paiement sont indicatives du calendrier, pas une confirmation d’encaissement.</p></section>
    <section class="detail-section contact-process"><div class="section-heading"><h3>Le prochain contact</h3><small>Aucun envoi automatique</small></div><div class="contact-clock" data-contact-clock="${esc(c.id)}" data-clock-detail="true" role="timer" aria-live="off"></div><div class="process-line"><strong>01 Appel</strong><span>→</span><strong>02 SMS si sans réponse</strong><span>→</span><strong>03 WhatsApp vocal à +24 h</strong></div><p class="suggestion">${waiting?'À partir du '+esc(fmtTime(c.followup_at))+' : ':''}${esc(actionLabels[c.next_action])}${c.status==='paused'?' · Ne pas relancer tant que le dossier est en pause.':'.'}</p><div class="actions"><button class="primary contact-log-button" id="log-contact" type="button">Noter une prise de contact <span aria-hidden="true">＋</span></button></div><details class="draft-message"><summary>Exemple de SMS · à adapter et envoyer toi-même</summary><p id="sms-draft">${esc(sms)}</p><button class="secondary" id="copy-sms" type="button">Copier le SMS</button></details></section>
    <form id="case-form"><section class="detail-section"><div class="section-heading"><h3>Comprendre la personne</h3><small>Notes privées · équipe onboarding</small></div><div class="form-grid">${field('goal','Ce qu’elle veut changer / manifester',true)}${field('motivations','Ses motivations')}${field('obstacles','Ses freins')}${field('routine','Sa routine réaliste',true)}${field('notes','Notes utiles pour le suivi',true)}</div><div class="checks">${[['training_access','Accès formation et communauté confirmé'],['feedback_explained','Feedback J+14 expliqué'],['coaching_booked','Premier coaching agendé']].map(([key,label])=>`<label><input type="checkbox" name="${key}" ${(key==='training_access'?(c.training_access||c.community_access):c[key])?'checked':''} />${label}</label>`).join('')}</div><p class="small" style="margin-top:14px">Note uniquement ce qui est utile à l’accompagnement, sans détail médical ou intime inutile.</p></section>
    <section class="detail-section"><div class="section-heading"><h3>Organiser la suite</h3><small>Heures · ${esc(zone)}</small></div><div class="form-grid"><label>État du dossier<select name="status">${options(statusLabels,c.status)}</select></label><label>Prochaine action<select name="next_action">${options(actionLabels,c.next_action)}</select></label><label>Onboarding convenu le<input type="datetime-local" name="onboarding_at" value="${datetime(c.onboarding_at)}" /></label><label>Premier coaching convenu le<input type="datetime-local" name="coaching_at" value="${datetime(c.coaching_at)}" /><small>À partir du ${esc(fmtDate(c.coaching_from))} · date Paris.</small></label><label>Rappel de contact<input type="datetime-local" name="followup_at" value="${datetime(c.followup_at)}" /></label></div><p class="small" style="margin-top:14px">Ces dates servent au suivi interne. Elles ne créent pas d’invitation, de lien visio ou de réservation dans un agenda.</p></section><div class="savebar"><span id="save-state">Fiche enregistrée</span><button type="submit" class="primary">Enregistrer la fiche</button></div></form>
    <p id="detail-message" role="status" hidden></p><section class="detail-section"><div class="section-heading"><h3>Historique des contacts</h3></div><p class="small">Les 100 dernières actions · ${esc(zone)}</p><ul id="history" class="history"></ul><div class="actions" style="margin-top:18px"><button class="quiet" id="copy-draft" type="button">Copier mon brouillon</button><button class="quiet" id="reload-case" type="button">Recharger la fiche</button></div></section>`;
  renderHistory();
  renderClocks();
  $('case-form').addEventListener('input',setDirty);
  $('case-form').addEventListener('change',setDirty);
  $('case-form').elements.onboarding_at.addEventListener('change',(event)=>{
    if(event.target.value){
      $('case-form').elements.status.value='booked';
      $('case-form').elements.next_action.value='onboarding';
      $('case-form').elements.followup_at.value=event.target.value;
    }
  });
  $('case-form').addEventListener('submit',(e)=>{e.preventDefault();save('updated');});
  $('log-contact').addEventListener('click',openContact);
  $('history').addEventListener('click',(e)=>{const b=e.target.closest('[data-delete-event]');if(b)deleteEvent(b.dataset.deleteEvent);});
  $('case-form').elements.coaching_at.addEventListener('change',(e)=>{if(e.target.value)$('case-form').elements.coaching_booked.checked=true;});
  $('reload-case').addEventListener('click',()=>selectCase(c.id));
  $('copy-draft').addEventListener('click',()=>copy(JSON.stringify({...getPatch()},null,2)));
  $('copy-sms').addEventListener('click',()=>copy(sms));
  $('back-list').addEventListener('click',()=>document.querySelector('.directory').scrollIntoView({behavior:'smooth'}));
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copié.');}catch{toast('Copie automatique indisponible : sélectionne le texte pour le copier.');}}
async function selectCase(id) {
  if(!canLeave())return;
  const seq=++state.detailSeq;state.detailLoading=true;$('detail').inert=true;
  try {
    const data=demo?{case:demoTimed(demoCases.find(c=>c.id===id)),events:demoEvents.get(id)||[]}:await api(`?id=${encodeURIComponent(id)}`);
    if(seq!==state.detailSeq)return;
    state.selected=id;state.current=data.case;state.events=data.events;state.dirty=false;state.pending=null;
    renderList();renderDetail();
    if(matchMedia('(max-width:760px)').matches)$('detail').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e){message(e.message);}finally{if(seq===state.detailSeq){state.detailLoading=false;$('detail').inert=false;}}
}
function getPatch() {
  const form=$('case-form');const data=new FormData(form),patch={};
  for(const key of ['goal','motivations','obstacles','routine','notes','status','next_action'])patch[key]=data.get(key);
  for(const key of ['training_access','feedback_explained','coaching_booked'])patch[key]=form.elements[key].checked;
  patch.community_access=patch.training_access;
  for(const key of ['followup_at','onboarding_at','coaching_at'])patch[key]=data.get(key)?new Date(data.get(key)).toISOString():null;
  return patch;
}
function openContact() {
  if(state.saving||state.detailLoading)return;
  $('contact-form').reset();
  state.contactOpenedAt=new Date().toISOString();
  $('contact-time').value=datetime(state.contactOpenedAt);
  state.contactDefaultTime=$('contact-time').value;
  $('contact-time').max=datetime(new Date().toISOString());
  $('contact-error').hidden=true;state.modalDirty=false;
  $('contact-dialog').showModal();
  $('contact-kind').focus();
}
function closeContact() {
  if(state.saving)return;
  if(state.modalDirty&&!confirm('Fermer sans enregistrer cette prise de contact ?'))return;
  $('contact-dialog').close();state.modalDirty=false;
}
$('contact-kind').innerHTML='<option value="">Choisir un scénario…</option>'+options(CONTACT_LABELS,'');
$('contact-timezone').textContent='Heure locale · '+zone+' · modifiable pour un contact passé.';
$('contact-form').addEventListener('input',()=>{state.modalDirty=true;$('contact-time').setCustomValidity('');$('contact-time').max=datetime(new Date().toISOString());});
$('close-contact').addEventListener('click',closeContact);
$('cancel-contact').addEventListener('click',closeContact);
$('contact-dialog').addEventListener('cancel',e=>{e.preventDefault();closeContact();});
$('contact-form').addEventListener('submit',e=>{
  e.preventDefault();
  const raw=$('contact-time').value;
  // La date affichée est à la minute, mais l'heure courante conserve ses secondes
  // pour que deux actions saisies dans la même minute gardent le bon ordre.
  const at=raw===state.contactDefaultTime?state.contactOpenedAt:raw&&Number.isFinite(new Date(raw).getTime())?new Date(raw).toISOString():'';
  if(!validContactTime(at)){ $('contact-time').setCustomValidity('Choisis la date et l’heure réelles du contact.');$('contact-time').reportValidity();return; }
  const kind=$('contact-kind').value,note=$('contact-note').value.trim();
  if(kind==='note'&&!note){$('contact-error').textContent='Ajoute une note avant de l’enregistrer.';$('contact-error').hidden=false;return;}
  save(kind,{note,occurred_at:at});
});
async function save(kind, contact={}) {
  if(state.saving||state.detailLoading||!$('case-form').reportValidity())return;
  const note=contact.note||'',patch=getPatch();
  const occurred_at=contact.occurred_at||state.pending?.at||new Date().toISOString();
  if(state.current.status==='paused' && !['updated','note'].includes(kind) && !confirm('Ce dossier est en pause. Reprendre le suivi et enregistrer ce contact ?'))return;
  if(kind==='whatsapp_sent' && state.current.next_action==='whatsapp' && Date.parse(state.current.followup_at)>Date.parse(occurred_at) && !confirm('Les 24 heures ne sont pas encore écoulées. As-tu réellement déjà envoyé ce vocal ?'))return;
  const signature=JSON.stringify({case_id:state.selected,version:state.current.version,patch,kind,note,occurred_at});
  const command_id=state.pending?.signature===signature?state.pending.id:crypto.randomUUID();
  state.pending={signature,id:command_id,at:occurred_at};state.saving=true;$('detail').inert=true;$('contact-form').inert=true;
  $('save-state').textContent='Enregistrement…';$('detail-message').hidden=true;$('contact-error').hidden=true;
  let succeeded=false;
  try {
    let data;
    if(demo){
      const c=demoCases.find(c=>c.id===state.selected);Object.assign(c,patch);
      const events=demoEvents.get(c.id)||[];
      if(!events.some(e=>e.kind!=='note'&&Date.parse(e.occurred_at)>Date.parse(occurred_at)))Object.assign(c,contactStep(kind,occurred_at));
      c.version++;data={case:{...c}};
      demoEvents.set(c.id,[{id:command_id,kind,note,occurred_at,can_delete:true},...events].sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)));
      data.case=demoTimed(c);
    } else data=await api('',{case_id:state.selected,version:state.current.version,command_id,patch,kind,note,occurred_at});
    state.current=data.case;state.dirty=false;state.modalDirty=false;state.pending=null;succeeded=true;
    try{state.events=demo?(demoEvents.get(state.selected)||[]):(await api(`?id=${state.selected}`)).events;}
    catch{state.events=[{kind,note,occurred_at},...state.events].sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at));}
    $('contact-dialog').close();renderDetail();
    toast(demo?'Enregistré dans la démonstration uniquement.':kind==='updated'?'Fiche enregistrée.':'Prise de contact enregistrée.');
    try{await loadList();}catch{message('Enregistrement effectué. La liste sera actualisée au prochain chargement.');}
  } catch(e){
    state.dirty=true;
    const error=e.message || 'Connexion interrompue. Ton brouillon reste affiché : réessaie.';
    $('detail-message').textContent=error;$('detail-message').hidden=false;
    if($('contact-dialog').open){$('contact-error').textContent=error;$('contact-error').hidden=false;}
    $('save-state').textContent='Non enregistré · brouillon conservé';$('save-state').className='unsaved';
  } finally{
    state.saving=false;$('detail').inert=false;$('contact-form').inert=false;
    if(succeeded&&kind!=='updated')$('log-contact').focus({preventScroll:true});
  }
}
async function deleteEvent(id) {
  if(state.saving||state.detailLoading)return;
  if(state.dirty)return toast('Enregistre d’abord les modifications de la fiche.');
  const event=state.events.find(e=>e.id===id);
  if(!event?.can_delete)return;
  if(!confirm('Supprimer cette entrée de l’historique ? Les notes et l’état de la fiche resteront inchangés.'))return;
  state.saving=true;$('detail').inert=true;
  try{
    if(demo){
      demoEvents.set(state.selected,(demoEvents.get(state.selected)||[]).filter(e=>e.id!==id));
      const c=demoCases.find(c=>c.id===state.selected);c.version++;state.current=demoTimed(c);
    }else{
      const data=await api('',{action:'delete_event',case_id:state.selected,version:state.current.version,event_id:id});
      state.current=data.case;
    }
    state.events=state.events.filter(e=>e.id!==id);state.pending=null;renderDetail();
    toast('Entrée supprimée de l’historique.');
    try{await loadList();}catch{message('Entrée supprimée. La liste sera actualisée au prochain chargement.');}
  }catch(e){$('detail-message').textContent=e.message;$('detail-message').hidden=false;}
  finally{state.saving=false;$('detail').inert=false;}
}

$('case-list').addEventListener('click',(e)=>{const b=e.target.closest('[data-case]');if(b)selectCase(b.dataset.case);});
$('refresh').addEventListener('click',()=>loadList().catch(e=>message(e.message)));
$('load-more').addEventListener('click',()=>{if(!state.loading)loadList(true).catch(e=>message(e.message));});
$('filter').addEventListener('change',()=>loadList().catch(e=>message(e.message)));
document.querySelectorAll('[data-filter]').forEach((b)=>b.addEventListener('click',()=>{$('filter').value=b.dataset.filter;loadList().catch(e=>message(e.message));}));
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadList().catch(e=>message(e.message)),250);});
async function openCrm() {
  await loadList();$('login-screen').hidden=true;$('crm-screen').hidden=false;
}
$('login-form').addEventListener('submit',async(e)=>{
  e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;$('login-message').textContent='Connexion…';
  try{
    const data=new FormData(e.currentTarget);
    const res=await fetch('/.netlify/functions/closer-login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({email:data.get('email'),password:data.get('password')}),signal:AbortSignal.timeout(20000)});
    if(!res.ok)throw new Error(res.status===401?'Email ou mot de passe incorrect.':'Connexion momentanément indisponible.');
    $('login-form').reset();await openCrm();$('login-message').textContent='';
  }catch(e){$('login-message').textContent=e.message;}finally{button.disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  if(!canLeave())return;
  try{if(!demo){const res=await fetch('/.netlify/functions/closer-logout',{method:'POST',credentials:'same-origin'});if(!res.ok)throw new Error();}state.dirty=false;location.assign('/onboarding/');}catch{message('Déconnexion impossible pour le moment. Réessaie.');}
});
if(demo){$('demo-banner').hidden=false;openCrm().then(()=>selectCase(demoCases[0].id));}
else openCrm().catch(e=>{if(e.status!==401)$('login-message').textContent=e.message;});
setInterval(()=>{
  // La fiche ouverte et ses brouillons ne sont jamais remplacés par un rafraîchissement.
  if(!$('crm-screen').hidden && !document.hidden && !state.loading && !state.saving)loadList().catch(e=>message(e.message));
},60000);
// Compteur visuel uniquement : aucune requête réseau chaque seconde.
setInterval(()=>{if(!$('crm-screen').hidden&&!document.hidden)renderClocks();},1000);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden){
    renderClocks();
    // Resynchroniser l'heure après une mise en veille, sans remplacer le brouillon.
    if(!$('crm-screen').hidden&&!state.loading&&!state.saving)loadList().catch(e=>message(e.message));
  }
});
