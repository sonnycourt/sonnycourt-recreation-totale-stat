import { presentCase } from '../../netlify/functions/lib/onboarding-domain.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const demo = new URLSearchParams(location.search).get('demo') === '1';
const statusLabels = { new:'Nouveau', contacting:'Contact en cours', awaiting:'En attente de réponse', contacted:'Contact établi', booked:'Onboarding planifié', done:'Accueil réalisé', paused:'En pause' };
const actionLabels = { call:'Appeler', sms:'Envoyer le SMS', whatsapp:'WhatsApp vocal, si toujours sans réponse', followup:'Prévoir la suite', onboarding:'Planifier / réaliser l’onboarding', none:'Aucune relance prévue' };
const kindLabels = { updated:'Fiche mise à jour', call_no_answer:'Appel · sans réponse', sms_sent:'SMS envoyé manuellement', whatsapp_sent:'WhatsApp vocal envoyé', contacted:'Contact établi', completed:'Onboarding réalisé', note:'Note de suivi' };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const state = { cases:[], total:0, selected:null, current:null, dirty:false, saving:false, pending:null, listSeq:0, detailSeq:0, loading:false, detailLoading:false, events:[] };
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
window.addEventListener('beforeunload',(e)=>{if(state.dirty || state.saving){e.preventDefault();e.returnValue='';}});

async function api(path='',body) {
  const res=await fetch(`/.netlify/functions/onboarding-crm${path}`,{
    method:body?'POST':'GET', credentials:'same-origin', cache:'no-store',
    headers:{'x-onboarding-client':'1',...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(40000),
  });
  const data=await res.json();
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
  training_access:i>0,community_access:i>0,feedback_explained:i===3,version:1,
}));
const demoEvents = new Map();
function demoList() {
  const filter=$('filter').value, search=$('search').value.toLocaleLowerCase();
  const due=(c)=>!['done','paused'].includes(c.status)&&(c.status==='new'||(c.followup_at && Date.parse(c.followup_at)<=Date.now()));
  const rows=demoCases.filter((c)=>(filter==='all'||(filter==='due'?due(c):c.status===filter))&&`${c.name} ${c.email} ${c.country} ${country(c.country)} ${c.city}`.toLowerCase().includes(search));
  return { cases:rows,total:rows.length, counts:{all:demoCases.length,new:demoCases.filter(c=>c.status==='new').length,due:demoCases.filter(due).length,booked:demoCases.filter(c=>c.status==='booked').length,done:demoCases.filter(c=>c.status==='done').length},actor:{name:'Romain · démo',id:22},refreshedAt:new Date().toISOString() };
}

function renderList() {
  $('total').textContent=`${state.total}`;
  $('case-list').innerHTML=state.cases.length?state.cases.map((c)=>`<div role="listitem"><button class="person ${c.id===state.selected?'selected':''}" data-case="${esc(c.id)}" aria-pressed="${c.id===state.selected}"><span class="person-top"><span class="avatar">${esc(initials(c.name))}</span><span><strong>${esc(c.name)}</strong><span class="place">${esc(country(c.country))}${c.city?' · '+esc(c.city):''}</span></span></span><span class="person-bottom"><span class="tag ${esc(c.status)}">${esc(statusLabels[c.status])}</span><small>${esc(fmtDate(c.purchased_at))}</small></span><span class="person-next">${esc(actionLabels[c.next_action])}${c.followup_at?' · '+esc(fmtTime(c.followup_at)):''}</span></button></div>`).join(''):'<p class="empty small">Aucun dossier dans cette sélection.</p>';
  $('load-more').hidden=state.cases.length>=state.total;
}
async function loadList(append=false) {
  const seq=++state.listSeq;state.loading=true;
  try {
    const offset=append?state.cases.length:0;
    const q=new URLSearchParams({ filter:$('filter').value,search:$('search').value.trim(),offset:String(offset) });
    const data=demo?demoList():await api(`?${q}`);
    if(seq!==state.listSeq)return;
    state.cases=append?[...state.cases,...data.cases]:data.cases;state.total=data.total;
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
  $('history').innerHTML=state.events.length?state.events.map((e)=>`<li><div class="history-head"><span>${esc(kindLabels[e.kind]||e.kind)}</span><time>${esc(fmtTime(e.occurred_at))}</time></div>${e.note?`<p>${esc(e.note)}</p>`:''}</li>`).join(''):'<li class="small">Aucun contact noté pour le moment.</li>';
}
function renderDetail() {
  const c=state.current;
  const phone=(c.phone||'').replace(/[^+\d]/g,'');
  const waiting=c.followup_at && Date.parse(c.followup_at)>Date.now();
  const sms=`Hello ${c.name.split(' ')[0]}, c’est Romain, ton coach personnel dans Esprit Subconscient 2.0. Je viens de t’appeler pour te souhaiter la bienvenue ! Quand serais-tu disponible pour un échange de 15 à 20 minutes afin de bien démarrer ?`;
  $('detail').innerHTML=`
    <div class="detail-header"><button class="quiet mobile-back" id="back-list">← Revenir à la liste</button><p class="eyebrow">DOSSIER D’ACCUEIL</p><div class="detail-title"><h2>${esc(c.name)}</h2><span class="tag ${esc(c.status)}">${esc(statusLabels[c.status])}</span></div><div class="contact-line"><span>${esc(country(c.country))}${c.city?' · '+esc(c.city):''}</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${phone?`<a href="tel:${esc(phone)}">${esc(c.phone)}</a>`:'<span>Téléphone non renseigné</span>'}</div>${c.special_instructions?`<p class="notice">${esc(c.special_instructions)}</p>`:''}</div>
    <section class="detail-section"><div class="section-heading"><h3>Les repères du parcours</h3><small>Dates · Paris</small></div><div class="dates"><div class="date-item">Inscription à la formation<strong>${esc(fmtDate(c.purchased_at))}</strong></div><div class="date-item">${c.source==='legacy'?'Prochain versement prévu':'Premier versement prévu'}<strong>${esc(fmtDate(c.first_payment_date))}</strong><small>${esc(c.payment_date_source)}</small></div><div class="date-item">Premier coaching à partir du<strong>${esc(fmtDate(c.coaching_from))}</strong><small>J+33 · feedback personnel de Sonny à J+14, le ${esc(fmtDate(c.feedback_date))}.</small></div></div><p class="plan">${esc(c.plan_label)}. Les dates de paiement sont indicatives du calendrier, pas une confirmation d’encaissement.</p></section>
    <section class="detail-section contact-process"><div class="section-heading"><h3>Le prochain contact</h3><small>Aucun envoi automatique</small></div><div class="process-line"><strong>01 Appel</strong><span>→</span><strong>02 SMS si sans réponse</strong><span>→</span><strong>03 WhatsApp vocal à +24 h</strong></div><p class="suggestion">${waiting?'À partir du '+esc(fmtTime(c.followup_at))+' : ':''}${esc(actionLabels[c.next_action])}${c.status==='paused'?' · Ne pas relancer tant que le dossier est en pause.':'.'}</p><div class="actions">${phone?`<a class="primary" href="tel:${esc(phone)}">Appeler</a>`:''}<button class="secondary" data-contact="call_no_answer">Appel sans réponse</button><button class="secondary" data-contact="contacted">J’ai eu la personne</button><button class="secondary" data-contact="sms_sent">J’ai envoyé le SMS</button><button class="secondary" data-contact="whatsapp_sent">J’ai envoyé le vocal</button></div><details class="draft-message"><summary>Exemple de SMS · à adapter et envoyer toi-même</summary><p id="sms-draft">${esc(sms)}</p><button class="secondary" id="copy-sms" type="button">Copier le SMS</button></details></section>
    <form id="case-form"><section class="detail-section"><div class="section-heading"><h3>Comprendre la personne</h3><small>Notes privées · équipe onboarding</small></div><div class="form-grid">${field('goal','Ce qu’elle veut changer / manifester',true)}${field('motivations','Ses motivations')}${field('obstacles','Ses freins')}${field('routine','Sa routine réaliste',true)}${field('notes','Notes utiles pour le suivi',true)}</div><div class="checks">${[['training_access','Accès formation confirmé'],['community_access','Accès communauté confirmé'],['feedback_explained','Feedback J+14 expliqué']].map(([key,label])=>`<label><input type="checkbox" name="${key}" ${c[key]?'checked':''} />${label}</label>`).join('')}</div><p class="small" style="margin-top:14px">Note uniquement ce qui est utile à l’accompagnement, sans détail médical ou intime inutile.</p></section>
    <section class="detail-section"><div class="section-heading"><h3>Organiser la suite</h3><small>Heures · ${esc(zone)}</small></div><div class="form-grid"><label>État du dossier<select name="status">${options(statusLabels,c.status)}</select></label><label>Prochaine action<select name="next_action">${options(actionLabels,c.next_action)}</select></label><label>Onboarding convenu le<input type="datetime-local" name="onboarding_at" value="${datetime(c.onboarding_at)}" /></label><label>Premier coaching convenu le<input type="datetime-local" name="coaching_at" value="${datetime(c.coaching_at)}" /><small>À partir du ${esc(fmtDate(c.coaching_from))} · date Paris.</small></label><label>Rappel de contact<input type="datetime-local" name="followup_at" value="${datetime(c.followup_at)}" /></label></div><p class="small" style="margin-top:14px">Ces dates servent au suivi interne. Elles ne créent pas d’invitation, de lien visio ou de réservation dans un agenda.</p></section><div class="savebar"><span id="save-state">Fiche enregistrée</span><button type="submit" class="primary">Enregistrer la fiche</button></div></form>
    <p id="detail-message" role="status" hidden></p><section class="detail-section"><div class="section-heading"><h3>Historique des contacts</h3><button class="secondary" id="mark-done" type="button">Accueil réalisé ✓</button></div><p class="small">Les 100 dernières actions · ${esc(zone)}</p><ul id="history" class="history"></ul><div class="event-note"><label>Ajouter une note datée<textarea id="event-note" maxlength="4000" placeholder="Ce qui a été convenu, la réponse reçue…"></textarea></label><button class="secondary" id="add-note" type="button">Ajouter</button></div><div class="actions" style="margin-top:18px"><button class="quiet" id="copy-draft" type="button">Copier mon brouillon</button><button class="quiet" id="reload-case" type="button">Recharger la fiche</button></div></section>`;
  renderHistory();
  $('case-form').addEventListener('input',setDirty);
  $('case-form').addEventListener('change',setDirty);
  $('case-form').elements.onboarding_at.addEventListener('change',(event)=>{
    if(event.target.value){
      $('case-form').elements.status.value='booked';
      $('case-form').elements.next_action.value='onboarding';
      $('case-form').elements.followup_at.value=event.target.value;
    }
  });
  $('event-note').addEventListener('input',setDirty);
  $('case-form').addEventListener('submit',(e)=>{e.preventDefault();save('updated');});
  $('detail').querySelectorAll('[data-contact]').forEach((b)=>b.addEventListener('click',()=>save(b.dataset.contact)));
  $('mark-done').addEventListener('click',()=>save('completed'));
  $('add-note').addEventListener('click',()=>{if(!$('event-note').value.trim())return toast('Ajoute une note avant de l’enregistrer.');save('note');});
  $('reload-case').addEventListener('click',()=>selectCase(c.id));
  $('copy-draft').addEventListener('click',()=>copy(JSON.stringify({...getPatch(),contact_note:$('event-note').value},null,2)));
  $('copy-sms').addEventListener('click',()=>copy(sms));
  $('back-list').addEventListener('click',()=>document.querySelector('.directory').scrollIntoView({behavior:'smooth'}));
}
async function copy(text){try{await navigator.clipboard.writeText(text);toast('Copié.');}catch{toast('Copie automatique indisponible : sélectionne le texte pour le copier.');}}
async function selectCase(id) {
  if(!canLeave())return;
  const seq=++state.detailSeq;state.detailLoading=true;$('detail').inert=true;
  try {
    const data=demo?{case:{...demoCases.find(c=>c.id===id)},events:demoEvents.get(id)||[]}:await api(`?id=${encodeURIComponent(id)}`);
    if(seq!==state.detailSeq)return;
    state.selected=id;state.current=data.case;state.events=data.events;state.dirty=false;state.pending=null;
    renderList();renderDetail();
    if(matchMedia('(max-width:760px)').matches)$('detail').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(e){message(e.message);}finally{if(seq===state.detailSeq){state.detailLoading=false;$('detail').inert=false;}}
}
function getPatch() {
  const form=$('case-form');const data=new FormData(form),patch={};
  for(const key of ['goal','motivations','obstacles','routine','notes','status','next_action'])patch[key]=data.get(key);
  for(const key of ['training_access','community_access','feedback_explained'])patch[key]=form.elements[key].checked;
  for(const key of ['followup_at','onboarding_at','coaching_at'])patch[key]=data.get(key)?new Date(data.get(key)).toISOString():null;
  return patch;
}
async function save(kind) {
  if(state.saving||state.detailLoading||!$('case-form').reportValidity())return;
  const note=$('event-note').value.trim(),patch=getPatch();
  if(state.current.status==='paused' && !['updated','note'].includes(kind) && !confirm('Ce dossier est en pause. Reprendre le suivi et enregistrer ce contact ?'))return;
  if(kind==='whatsapp_sent' && state.current.next_action==='whatsapp' && Date.parse(state.current.followup_at)>Date.now() && !confirm('Les 24 heures ne sont pas encore écoulées. As-tu réellement déjà envoyé ce vocal ?'))return;
  // Garder le même identifiant si un appel réseau échoue et que l'on réessaie à l'identique.
  const signature=JSON.stringify({case_id:state.selected,version:state.current.version,patch,kind,note});
  const command_id=state.pending?.signature===signature?state.pending.id:crypto.randomUUID();
  state.pending={signature,id:command_id};state.saving=true;$('detail').inert=true;
  const buttons=$('detail').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
  $('save-state').textContent='Enregistrement…';$('detail-message').hidden=true;
  try {
    let data;
    if(demo){
      const c=demoCases.find(c=>c.id===state.selected);Object.assign(c,patch);
      const steps={call_no_answer:['contacting','sms',new Date().toISOString()],sms_sent:['awaiting','whatsapp',new Date(Date.now()+86400000).toISOString()],whatsapp_sent:['awaiting','followup',null],contacted:['contacted','onboarding',null],completed:['done','none',null]};
      if(steps[kind])[c.status,c.next_action,c.followup_at]=steps[kind];
      c.version++;data={case:{...c}};
      demoEvents.set(c.id,[{kind,note,occurred_at:new Date().toISOString()},...(demoEvents.get(c.id)||[])]);
    } else data=await api('',{case_id:state.selected,version:state.current.version,command_id,patch,kind,note});
    state.current=data.case;state.dirty=false;state.pending=null;
    // Rafraîchissement d'historique non critique : une sauvegarde réussie reste réussie.
    try{state.events=demo?(demoEvents.get(state.selected)||[]):(await api(`?id=${state.selected}`)).events;}catch{state.events=[{kind,note,occurred_at:new Date().toISOString()},...state.events];}
    renderDetail();toast(demo?'Enregistré dans la démonstration uniquement.':'Fiche enregistrée.');
    try{await loadList();}catch{message('Fiche enregistrée. La liste sera actualisée au prochain chargement.');}
  } catch(e){state.dirty=true;$('detail-message').textContent=e.message || 'Connexion interrompue. Ton brouillon reste affiché : réessaie.';$('detail-message').hidden=false;$('save-state').textContent='Non enregistré · brouillon conservé';$('save-state').className='unsaved';}
  finally{state.saving=false;$('detail').inert=false;$('detail').querySelectorAll('button').forEach(b=>b.disabled=false);}
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
