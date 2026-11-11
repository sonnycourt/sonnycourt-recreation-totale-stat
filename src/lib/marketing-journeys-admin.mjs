import { CHANNELS, publicationUrl, trackingCoverage } from './marketing-links-contract.mjs';

export function initMarketingJourneys(doc=document,win=window) {
  const $=id=>doc.getElementById(id), demo=!['sonnycourt.com','www.sonnycourt.com'].includes(win.location.hostname)&&new URLSearchParams(win.location.search).get('demo')==='1';
  const endpoint='/.netlify/functions/admin-marketing-journeys';
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const date=v=>new Date(v).toLocaleString('fr-FR',{timeZone:'Europe/Zurich',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const money=v=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(v/100);
  const plan=v=>({spiffy_12x197:'12 mensualités',spiffy_one_time_1297:'Paiement comptant',spiffy_3x767:'3 mensualités',spiffy_6x397:'6 mensualités'}[v]||'Plan enregistré dans Spiffy');
  const quiz={finances_work:'Finances / travail',relationships:'Relations',confidence_action:'Confiance / action',stress_balance:'Stress / équilibre',new:'Découvre Sonny',some_videos:'Quelques vidéos vues',follower:'Suit Sonny depuis longtemps',employee:'Salarié',self_employed:'Indépendant',transition:'En transition',student:'Étudiant',exploring:'Curiosité / apprentissage',urgent:'Changement rapide souhaité'};
  let loaded=false,busy=false;
  async function read(path=''){
    const res=await win.fetch(endpoint+path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(25000)});
    const data=await res.json();if(!res.ok)throw new Error(data.error||'Lecture indisponible.');return data;
  }
  function showJourney(box,data) {
    box.replaceChildren();
    const cash=el('div','journey-cash');
    if(data.commerce?.available){
      cash.append(el('strong','',money(data.commerce.net_minor)+' encaissés nets'));
      cash.append(el('span','',`${money(data.commerce.gross_minor)} encaissés · ${money(data.commerce.refunded_minor)} remboursés · vérifié dans Spiffy le ${date(data.commerce.checked_at)}`));
    } else cash.append(el('span','','Encaissement non vérifié : la commande est confirmée, le montant n’est pas déduit du plan de paiement.'));
    box.append(cash);
    if(!data.observed_contacts)box.append(el('p','journey-warning','Parcours marketing non observé : aucun passage par un nouveau lien suivi n’est rattaché à cet achat.'));
    else box.append(el('p','journey-count',`${data.observed_contacts} contact${data.observed_contacts>1?'s':''} suivi${data.observed_contacts>1?'s':''} avant la commande`));
    if(data.limited)box.append(el('p','journey-warning','Parcours partiel : la limite d’affichage a été atteinte.'));
    const list=el('ol','journey-timeline');
    for(const point of data.timeline){
      const item=el('li',point.kind),time=el('time','',date(point.at));time.dateTime=point.at;
      item.append(time,el('strong','',point.label));
      if(point.channel)item.append(el('span','journey-channel',CHANNELS[point.channel]?.label||point.channel));
      if(trackingCoverage(point).retrospective)item.append(el('span','retro-badge','↶ Contenu suivi après publication'));
      let url;try{url=publicationUrl(point.publication_url);}catch{}
      if(url){const a=el('a','publication-open','Voir la publication ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';item.append(a);}
      list.append(item);
    }
    box.append(list);
    if(data.survey){const wrap=el('div','journey-quiz');wrap.append(el('h4','','Ses réponses avant l’achat'));for(const k of ['priority','familiarity','profession','urgency'])if(quiz[data.survey[k]])wrap.append(el('span','',quiz[data.survey[k]]));box.append(wrap);}
  }
  const example={id:'1',name:'Exemple de parcours',email:'Données fictives',product:'Esprit Subconscient 2.0',purchased_at:'2026-11-11T10:30:00Z',payment_mode:'spiffy_one_time_1297'};
  const exampleDetail={...example,observed_contacts:2,commerce:{available:true,net_minor:129700,gross_minor:129700,refunded_minor:0,checked_at:new Date().toISOString()},survey:{priority:'confidence_action',familiarity:'follower',urgency:'urgent'},timeline:[{at:'2026-11-01T10:00:00Z',label:'Les 7 affirmations',kind:'contact',channel:'instagram',published_on:'2026-10-01',link_created_at:'2026-11-01T09:00:00Z'},{at:'2026-11-08T09:00:00Z',label:'Inscription à la masterclass',kind:'registration'},{at:'2026-11-09T18:00:00Z',label:'Entrée dans la salle',kind:'session'},{at:'2026-11-11T10:00:00Z',label:'Un email pour passer à l’action',kind:'contact',channel:'email'},{at:'2026-11-11T10:30:00Z',label:'Commande Spiffy confirmée',kind:'purchase'}]};
  async function load(){
    if(busy)return;busy=true;$('refresh-purchases').disabled=true;$('purchases-status').textContent='Chargement des commandes…';
    try{
      const data=demo?{purchases:[example],limited:false}:await read();
      $('purchases-list').replaceChildren();
      $('purchases-status').textContent=data.purchases.length?`${data.purchases.length} commande${data.purchases.length>1?'s':''} affichée${data.purchases.length>1?'s':''}${data.limited?' · les 100 confirmations les plus récentes':''}${demo?' · démonstration fictive':''}`:'Aucune commande MC2 confirmée disponible.';
      for(const p of data.purchases){
        const card=el('details','purchase-card'),summary=el('summary'),who=el('div'),info=el('div'),box=el('div','journey-body');
        who.append(el('strong','',p.name||p.email),el('span','',p.email));info.append(el('strong','',p.product),el('span','',`${date(p.purchased_at)} · ${plan(p.payment_mode)}`));
        summary.append(who,info,el('span','purchase-arrow','⌄'));card.append(summary,box);
        let done=false,loading=false;
        const detail=async()=>{if(!card.open||done||loading)return;loading=true;box.replaceChildren(el('p','field-help','Lecture du parcours et vérification Spiffy…'));try{showJourney(box,demo?exampleDetail:await read('?purchase='+encodeURIComponent(p.id)));done=true;}catch(error){box.replaceChildren(el('p','journey-warning',error.message));const retry=el('button','copy-button','Réessayer');retry.type='button';retry.addEventListener('click',detail);box.append(retry);}finally{loading=false;}};
        card.addEventListener('toggle',detail);$('purchases-list').append(card);
      }
      loaded=true;
    }catch(error){$('purchases-status').textContent=error.message;}
    finally{busy=false;$('refresh-purchases').disabled=false;}
  }
  function tab(purchases){$('links-panel').hidden=purchases;$('purchases-panel').hidden=!purchases;$('tab-links').setAttribute('aria-pressed',String(!purchases));$('tab-purchases').setAttribute('aria-pressed',String(purchases));if(purchases&&!loaded)void load();}
  $('tab-links').addEventListener('click',()=>tab(false));$('tab-purchases').addEventListener('click',()=>tab(true));$('refresh-purchases').addEventListener('click',load);
}
