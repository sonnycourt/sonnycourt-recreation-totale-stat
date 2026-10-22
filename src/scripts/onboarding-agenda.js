import {parisDay} from '../../netlify/functions/lib/onboarding-domain.mjs';
import {timeZoneSummary,validMeetingLink} from '../../netlify/functions/lib/onboarding-organization.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function agendaWeek(at=Date.now(),shift=0) {
  const day=new Date(parisDay(new Date(at).toISOString())+'T12:00:00Z');
  day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7)+shift*7);
  const from=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+6);
  return {from,to:day.toISOString().slice(0,10)};
}
export function renderAgenda({events,from,to,organizationReady}) {
  const groups=new Map();for(const event of events){if(!groups.has(event.day))groups.set(event.day,[]);groups.get(event.day).push(event);}
  const date=day=>new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'}).format(new Date(day+'T12:00:00Z'));
  return `<p class="agenda-period">Du ${esc(date(from))} au ${esc(date(to))} · ${events.length} rendez-vous</p>
    ${!organizationReady?'<p class="notice">Les fuseaux et liens attendent l’activation de l’organisation.</p>':''}
    ${events.length?[...groups].map(([day,list])=>`<section class="agenda-day"><h3>${esc(date(day))}</h3>${list.map(event=>{
      const zone=timeZoneSummary(event.time_zone,event.at),time=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(event.at));
      return `<article class="agenda-event"><time datetime="${esc(event.at)}">${esc(time)}<small>Paris</small></time><div><span class="tag">${esc(event.label)}</span><h3>${esc(event.name)}</h3><p>${zone?`${esc(zone.local)} chez l’élève · ${esc(zone.label)}`:'Fuseau élève non renseigné'}</p></div><div class="agenda-actions"><button class="secondary" type="button" data-agenda-case="${esc(event.case_id)}">Ouvrir la fiche</button>${event.meeting_link&&validMeetingLink(event.meeting_link)?`<a class="quiet" href="${esc(event.meeting_link)}" target="_blank" rel="noopener noreferrer">Rejoindre la visio ↗</a>`:''}</div></article>`;
    }).join('')}</section>`).join(''):'<div class="agenda-empty"><h3>Aucun rendez-vous planifié cette semaine.</h3><p>Renseigne une date dans la fiche d’un élève : elle apparaîtra ici.</p></div>'}`;
}
export function setupAgenda({api,demoData,onOpenCase,onSelect}) {
  const $=id=>document.getElementById(id);let active=false,shift=0,sequence=0;
  async function refresh(){
    const seq=++sequence,range=agendaWeek(Date.now(),shift);
    $('agenda-message').hidden=false;$('agenda-message').textContent='Chargement de l’agenda…';$('agenda-content').hidden=true;
    try {
      const data=demoData?demoData(range):await api('?'+new URLSearchParams({view:'agenda',...range}));
      if(seq!==sequence)return;
      $('agenda-content').innerHTML=renderAgenda(data);$('agenda-content').hidden=false;$('agenda-message').hidden=true;
    } catch(error){if(seq===sequence)$('agenda-message').textContent='Agenda indisponible. Réessaie avec « Actualiser ». Les fiches et leurs notes restent accessibles.';}
  }
  function select(value){if(value)onSelect();active=value;$('agenda-panel').hidden=!value;$('tab-agenda').setAttribute('aria-pressed',String(value));if(value)refresh();}
  $('tab-agenda').addEventListener('click',()=>select(true));
  $('agenda-previous').addEventListener('click',()=>{shift--;refresh();});
  $('agenda-next').addEventListener('click',()=>{shift++;refresh();});
  $('agenda-today').addEventListener('click',()=>{shift=0;refresh();});
  $('agenda-content').addEventListener('click',e=>{const button=e.target.closest('[data-agenda-case]');if(button)onOpenCase(button.dataset.agendaCase);});
  return {isActive:()=>active,select,refresh};
}
