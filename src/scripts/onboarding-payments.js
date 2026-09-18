import {paymentSummary} from '../../netlify/functions/lib/onboarding-payments-domain.mjs';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=cents=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(cents/100);
const date=v=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(v)):'Date non disponible';
const labels={paid:'Encaissé',failed:'Échoué',upcoming:'À venir',pending:'À confirmer',stopped:'Arrêté',refunded:'Remboursé / partiel',disputed:'Contesté',unknown:'Non vérifié'};
function status(value){return `<span class="payment-status ${esc(value)}">${esc(labels[value]||labels.unknown)}</span>`;}
export function renderPayments(data){
  const s=data.summary,uncertain=data.rows.filter(r=>!r.available||r.stale).length;
  const times=data.rows.filter(r=>r.available).map(r=>Date.parse(r.checked_at)).filter(Number.isFinite);
  const first=(r)=>`${status(r.first_status)}${r.first_date?`<small>${esc(date(r.first_date))}</small>`:''}`;
  const next=(r)=>`${status(r.next_status)}${r.next_date?`<strong>${esc(money(r.amount_minor))}</strong><small>${esc(date(r.next_date))}</small>`:''}`;
  return `<div class="payment-metrics"><article><span>Premier versement encaissé</span><strong>${s.first_paid}</strong><small>Élèves au plan 197 € / mois</small></article><article><span>Premier versement échoué</span><strong>${s.first_failed}</strong><small>Non régularisé à la dernière vérification</small></article><article><span>À venir sous 7 jours</span><strong>${s.upcoming_count}<small> · ${esc(money(s.upcoming_minor))}</small></strong><small>Prochaines échéances du plan 197 € / mois</small></article></div>
    <p class="payments-note">Ces compteurs concernent les ${s.cohort} élèves au plan 197 €. Le démarrage à 0 € n’est jamais compté comme un encaissement.${s.unverified?` ${s.unverified} dossier(s) non actualisé(s), exclus des compteurs.`:''}</p>
    ${uncertain?`<p class="payments-warning">${uncertain} dossier(s) à vérifier : les données indisponibles ne sont pas assimilées à un échec ou à un paiement reçu. Les anciennes données sont signalées ci-dessous.</p>`:''}
    <div class="payments-table-wrap"><table class="payments-table"><caption class="sr-only">Résultat du premier versement et prochaine échéance de chaque élève</caption><thead><tr><th>Élève</th><th>Premier versement</th><th>Prochain versement</th><th>Versements encaissés</th></tr></thead><tbody>${data.rows.map(r=>`<tr><th scope="row">${esc(r.name)}<small>${r.plan==='legacy_three'?'Ancien modèle · 3 × 767 €':r.plan==='six'?'6 × 347 €':'12 × 197 €'}</small>${r.stale?'<small class="payments-stale">Anciennes données · '+esc(date(r.checked_at))+'</small>':''}</th><td data-label="Premier versement">${first(r)}</td><td data-label="Prochain versement">${next(r)}</td><td data-label="Versements encaissés">${r.available?`${r.paid_count} / ${r.plan==='legacy_three'?3:r.plan==='six'?6:12}`:'—'}</td></tr>`).join('')||'<tr><td colspan="4">Aucun élève pour le moment.</td></tr>'}</tbody></table></div>
    <p class="payments-note">Dates et heures de Paris.${times.length?' Données vérifiées entre '+esc(date(new Date(Math.min(...times)).toISOString()))+' et '+esc(date(new Date(Math.max(...times)).toISOString()))+'.':''} Actualisation à l’ouverture de cet onglet ou via « Actualiser », avec un cache de ${data.cacheMinutes||30} minutes. Les dates futures sont prévisionnelles.</p>`;
}
export function setupPayments({api,demo,demoCases,onView}){
  const $=id=>document.getElementById(id);let active=false,loading=false;
  async function refresh(){
    if(loading)return;loading=true;$('payments-panel').setAttribute('aria-busy','true');
    $('payments-message').textContent='Vérification des données Spiffy…';$('payments-message').hidden=false;
    try{
      let data;
      if(demo){const now=Date.now(),rows=demoCases.map((c,i)=>({case_id:c.id,name:c.name,plan:'twelve',available:true,paid_count:i===0?1:0,first_status:['paid','failed','upcoming','upcoming'][i],next_status:i===1?'failed':'upcoming',first_date:new Date(now+(i<2?-1:2)*86400000).toISOString(),next_date:new Date(now+3*86400000).toISOString(),amount_minor:19700,checked_at:new Date(now).toISOString()}));data={rows,summary:paymentSummary(rows),cacheMinutes:30};}
      else data=await api('?view=payments');
      $('payments-content').innerHTML=renderPayments(data);$('payments-content').hidden=false;$('payments-message').hidden=true;
    }catch{
      // Ne pas laisser d'anciens compteurs paraître actuels après une erreur.
      $('payments-content').hidden=true;$('payments-message').textContent='Les versements ne sont pas disponibles pour le moment. Clique sur « Actualiser » pour réessayer. Les fiches onboarding restent accessibles.';
    }finally{loading=false;$('payments-panel').setAttribute('aria-busy','false');}
  }
  function select(value){active=value;$('onboarding-panel').hidden=value;$('payments-panel').hidden=!value;$('tab-onboarding').setAttribute('aria-pressed',String(!value));$('tab-payments').setAttribute('aria-pressed',String(value));onView(value);if(value)refresh();}
  $('tab-onboarding').addEventListener('click',()=>select(false));$('tab-payments').addEventListener('click',()=>select(true));
  return {isActive:()=>active,refresh};
}
