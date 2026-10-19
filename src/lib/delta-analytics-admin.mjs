const $=s=>document.querySelector(s),n=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const fmt=new Intl.NumberFormat('fr-CH',{maximumFractionDigits:1}),f=v=>fmt.format(Number(v)||0),pct=(a,b)=>b?f(100*a/b)+' %':'—',median=values=>{const a=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:0;};
const labels={hero:'Offre sous la vidéo',histoire:'Pourquoi Delta Vision',ressentir:'Ce que tu reçois',garantie:'Garantie',closing:'Offre finale',sticky:'Bouton fixe',presentation:'Présentation',methode:'Méthode',science:'Science',tarif:'Tarif final'};
function table(selector,headers,rows){const t=n('table',''),head=n('tr','');headers.forEach(h=>head.append(n('th',h)));const thead=n('thead','');thead.append(head);t.append(thead);const tbody=n('tbody','');rows.forEach(row=>{const tr=n('tr','');row.forEach(v=>tr.append(n('td',String(v))));tbody.append(tr);});t.append(tbody);$(selector).replaceChildren(rows.length?t:n('p','Pas encore de données sur cette période.'));}
function bar(selector,label,count,total){const row=n('div','');row.className='bar-row';const track=n('div','');track.className='bar';const fill=n('i','');fill.style.width=(total?Math.min(100,100*count/total):0)+'%';track.append(fill);row.append(n('span',label),track,n('span',`${count} · ${pct(count,total)}`));$(selector).append(row);}
function render(r){
 const v=r.visits,all=v.length,starts=v.filter(x=>x.video_started).length,offer=v.filter(x=>x.offer_seen).length,clicks=v.filter(x=>x.clicked).length,loaded=v.filter(x=>x.checkout_loaded).length;
 const ids=new Set(v.map(x=>x.visit_id)),sales=r.commerce.sales||[],matched=sales.filter(s=>ids.has(s.visit_id)),buyers=new Set(matched.map(s=>s.visit_id)).size;
 $('#coverage').textContent=`Suivi détaillé consenti : ${all} visites, ${new Set(v.map(x=>x.visitor_id)).size} navigateurs distincts. Les arrivées sans cookies figurent dans le compteur séparé ci-dessous ; les deux totaux ne s’additionnent pas. Actualisé à ${new Date(r.generated_at).toLocaleTimeString('fr-CH')}. Dates selon le fuseau de cet ordinateur.`;
 $('#kpis').replaceChildren();
 for(const [value,label]of [[f(all),'Visites mesurées'],[f(median(v.map(x=>x.active)))+' s','Temps actif médian'],[pct(clicks,all),'Visites → clic achat'],[r.commerce.available?f(matched.reduce((sum,s)=>sum+s.net_minor,0)/100)+' €':'—','Encaissé initial net rattaché']]){const card=n('div','');card.className='kpi';card.append(n('strong',value),n('span',label));$('#kpis').append(card);}
 $('#funnel').replaceChildren();for(const [title,count]of [['Vidéo démarrée',starts],['Offre vue',offer],['Clic achat',clicks],['Checkout chargé',loaded],['Visites acheteuses',r.commerce.available?buyers:null]]){const el=n('div','');el.className='stage';el.append(n('span',title),n('strong',count===null?'—':f(count)),n('small',count===null?'Ventes non vérifiées':`${pct(count,all)} des ${all} visites`));$('#funnel').append(el);}
 $('#commerce').textContent=r.commerce.available?`${matched.length} achat(s) confirmé(s) rattaché(s), encaissé initial brut ${f(matched.reduce((s,x)=>s+x.initial_minor,0)/100)} €, remboursements ${f(matched.reduce((s,x)=>s+x.refunded_minor,0)/100)} €. ${sales.length-matched.length} vente(s) sans rattachement aux visites sélectionnées (dont autres filtres/périodes). ${r.commerce.unverified} commande(s) réussie(s) non chiffrable(s). Ventes recherchées depuis le début de période jusqu’à maintenant ; la cohorte récente peut encore convertir.`:r.commerce.reason;
 const clickTimes=v.filter(x=>x.click_after!==null),watchTimes=v.filter(x=>x.video_started);
 $('#engagement').textContent=`Premier clic achat : ${clickTimes.length?f(median(clickTimes.map(x=>x.click_after)))+' s en médiane':'pas encore mesuré'}. Vidéo : ${watchTimes.length?f(median(watchTimes.map(x=>x.watched)))+' s regardées en médiane':'pas encore mesurée'}. ${v.filter(x=>x.duration>0&&x.watched>=x.duration/2).length} visite(s) ont réellement regardé au moins la moitié de la vidéo.`;
 table('#ctas',['Bouton','Visites exposées','Visites ayant cliqué','Clic / exposition'],r.ctas.map(x=>[labels[x.target]||x.target,x.exposures,x.clicks,pct(x.clicks,x.exposures)]));
 $('#scroll').replaceChildren();for(const depth of [25,50,75,90,100])bar('#scroll',depth+' %',v.filter(x=>x.scroll>=depth).length,all);
 table('#sections',['Section','Visites','Temps visible médian'],r.sections.map(x=>[labels[x.target]||x.target,x.visits,f(x.median_seconds)+' s']));
 $('#retention').replaceChildren();for(const row of r.retention)bar('#retention',`${Math.floor(row.bucket*10/60)}:${String(row.bucket*10%60).padStart(2,'0')}`,row.visits,starts);if(!r.retention.length)$('#retention').append(n('p','Pas encore de lecture mesurée.'));
 const groups=new Map();for(const x of v){const key=[x.source+(x.campaign?' · '+x.campaign:''),x.device,x.is_returning?'Retour':'Nouveau',x.price+' €'].join(' / ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);}
 table('#segments',['Source / appareil / profil / prix','Visites','Play','Clic achat','Achat confirmé'],[...groups].map(([key,rows])=>[key,rows.length,pct(rows.filter(x=>x.video_started).length,rows.length),pct(rows.filter(x=>x.clicked).length,rows.length),r.commerce.available?pct(rows.filter(x=>matched.some(s=>s.visit_id===x.visit_id)).length,rows.length):'—']));
 table('#errors',['Signal','Occurrences','Visites touchées'],r.errors.map(x=>[x.code,x.occurrences,x.visits]));
 const perf=r.performance.map(x=>[x.metric,f(x.median),f(x.p75),x.samples]);const startup=v.filter(x=>x.startup!==null);if(startup.length)perf.push(['Play → démarrage (ms)',f(median(startup.map(x=>x.startup))),'—',startup.length]);
 table('#performance',['Mesure','Médiane','P75','Échantillons'],perf);
}
let busy=false;
async function loadPageviews(q){
 $('#anonymous-count').textContent='Lecture du compteur sans cookies…';$('#anonymous-hours').replaceChildren();
 try{
  const res=await fetch('/.netlify/functions/admin-delta-vision-pageviews?'+new URLSearchParams({from:q.get('from'),to:q.get('to')}),{cache:'no-store',signal:AbortSignal.timeout(20000)}),r=await res.json();
  if(!res.ok)throw Error(r.error||'Compteur indisponible');
  $('#anonymous-count').textContent=`${f(r.pageviews)} chargements comptés sur cette période (consentement accepté, refusé ou non renseigné).`;
  table('#anonymous-hours',['Heure (fuseau de cet ordinateur)','Chargements'],r.hours.map(x=>[new Date(x.hour).toLocaleString('fr-CH'),x.count]));
 }catch(e){$('#anonymous-count').textContent=e.message;}
}
async function load(sales=false){if(busy)return;busy=true;$('#notice').textContent='Lecture des mesures…';document.querySelectorAll('#filters button').forEach(b=>b.disabled=true);
 try{const from=new Date($('#from').value+'T00:00:00'),to=new Date($('#to').value+'T00:00:00');to.setDate(to.getDate()+1);
  const q=new URLSearchParams({from:from.toISOString(),to:to.toISOString(),device:$('#device').value,price:$('#price').value,source:$('#source').value,sales:sales?'1':'0'});
  const res=await fetch('/.netlify/functions/admin-delta-vision-analytics?'+q,{cache:'no-store',signal:AbortSignal.timeout(45000)}),data=await res.json();
  if(res.status===401){$('#login').hidden=false;$('#workspace').hidden=true;$('#notice').textContent='Connexion privée requise.';return;}
  if(!res.ok)throw Error(data.error||'Rapport indisponible');$('#login').hidden=true;$('#workspace').hidden=false;render(data);$('#notice').textContent='';await loadPageviews(q);
 }catch(e){$('#notice').textContent=e.message;}finally{busy=false;document.querySelectorAll('#filters button').forEach(b=>b.disabled=false);}}
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=new Date(),week=new Date();week.setDate(week.getDate()-6);$('#from').value=localDate(week);$('#to').value=localDate(today);
$('#filters').addEventListener('submit',e=>{e.preventDefault();load();});$('#sales').addEventListener('click',()=>load(true));
$('#login').addEventListener('submit',async e=>{e.preventDefault();const button=$('#login button');button.disabled=true;try{const res=await fetch('/.netlify/functions/admin-es2-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#password').value})});if(!res.ok)throw Error('Connexion refusée.');$('#password').value='';await load();}catch(error){$('#notice').textContent=error.message;}finally{button.disabled=false;}});
load();
