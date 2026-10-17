import {coachingSlots, COACHING_STATUSES} from '../../netlify/functions/lib/onboarding-coachings.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localTime=v=>{if(!v)return '';const d=new Date(v);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export function readCoachings(form) {
  return [1,2,3].map(number=>{
    const value=key=>form.elements[`coaching_${number}_${key}`].value;
    const at=form.elements[number===1?'coaching_at':`coaching_${number}_at`].value;
    return {number,status:value('status'),scheduled_at:at?new Date(at).toISOString():null,
      duration_minutes:value('duration')?Number(value('duration')):null,notes:value('notes')};
  });
}
export function mountCoachings({form,row,saved,ready,zone}) {
  if(!ready){
    form.querySelector('.savebar').insertAdjacentHTML('beforebegin','<section class="detail-section"><h3>Les 3 coachings</h3><p class="small">Suivi des séances indisponible pour le moment. Les notes et l’accueil restent accessibles.</p></section>');
    return;
  }
  const slots=coachingSlots(row,saved);
  form.closest('#detail').querySelector('.detail-header').insertAdjacentHTML('beforeend','<nav class="coaching-shortcuts" aria-label="Dans cette fiche"><a href="#case-form">Accueil</a><a href="#coachings">Les 3 coachings <span aria-hidden="true">↓</span></a></nav>');
  const firstOpen=slots.find(s=>s.status==='planned')?.number || slots.find(s=>s.status==='pending')?.number || 1;
  form.querySelector('.coaching-date').remove();
  form.querySelector('.savebar').insertAdjacentHTML('beforebegin',`<section class="detail-section coaching-section" id="coachings">
    <div class="section-heading"><div><p class="eyebrow">ACCOMPAGNEMENT INDIVIDUEL</p><h3>Les 3 coachings</h3></div><span class="coaching-progress" id="coaching-progress"></span></div>
    <p class="small coaching-intro">Un espace par séance. Tes notes restent privées.</p>
    <div class="coaching-cards">${slots.map(s=>`<details class="coaching-card" data-coaching="${s.number}" ${s.number===firstOpen?'open':''}>
      <summary><span class="coaching-number">${String(s.number).padStart(2,'0')}</span><span class="coaching-summary"><strong>Coaching ${s.number}</strong><small data-coaching-date></small></span><span class="coaching-status" data-coaching-status></span><span class="coaching-chevron" aria-hidden="true">⌄</span></summary>
      <div class="coaching-body"><div class="coaching-fields">
        <label>Statut<select name="coaching_${s.number}_status">${Object.entries(COACHING_STATUSES).map(([v,l])=>`<option value="${v}" ${s.status===v?'selected':''}>${l}</option>`).join('')}</select></label>
        <label>Date et heure<input type="datetime-local" name="${s.number===1?'coaching_at':`coaching_${s.number}_at`}" value="${localTime(s.scheduled_at)}" /></label>
        <label>Durée réalisée <span class="optional">en minutes</span><input type="number" name="coaching_${s.number}_duration" min="1" max="240" step="1" placeholder="Ex. 60" value="${s.duration_minutes??''}" /></label>
      </div><label class="coaching-notes">Notes de la séance<textarea name="coaching_${s.number}_notes" maxlength="6000" rows="4" placeholder="Ce qui a été travaillé, ce qui a évolué, le prochain pas…">${esc(s.notes)}</textarea></label>
      <p class="small">${s.number===1?`Premier coaching à partir du ${esc(new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(row.coaching_from+'T12:00:00Z')))} · `:''}Heures · ${esc(zone)}</p>
      </div></details>`).join('')}</div>
    <p class="small coaching-footnote">Sauvegardé avec la fiche. Aucun email, rendez-vous ou paiement déclenché.</p></section>`);
  const sync=()=>{
    let done=0;
    for(const card of form.querySelectorAll('[data-coaching]')){
      const n=Number(card.dataset.coaching),status=form.elements[`coaching_${n}_status`].value;
      const at=form.elements[n===1?'coaching_at':`coaching_${n}_at`];
      const duration=form.elements[`coaching_${n}_duration`];
      at.required=['completed','absent','cancelled'].includes(status);duration.required=status==='completed';
      at.setCustomValidity(['completed','absent'].includes(status)&&at.value&&new Date(at.value).getTime()>Date.now()+300000?'Une séance réalisée ou une absence ne peut pas être dans le futur.':'');
      if(status==='completed')done++;
      card.querySelector('[data-coaching-status]').textContent=COACHING_STATUSES[status];
      card.querySelector('[data-coaching-status]').dataset.status=status;
      card.querySelector('[data-coaching-date]').textContent=at.value?new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(at.value)):'Date à définir';
    }
    form.querySelector('#coaching-progress').textContent=`${done} / 3 réalisés`;
  };
  form.querySelector('#coachings').addEventListener('input',e=>{
    const card=e.target.closest('[data-coaching]');
    if(card){const n=Number(card.dataset.coaching),status=form.elements[`coaching_${n}_status`],at=form.elements[n===1?'coaching_at':`coaching_${n}_at`];
      if(e.target===at&&at.value&&status.value==='pending')status.value='planned';
      if(e.target===status&&status.value==='pending')at.value='';
    }sync();
  });
  form.addEventListener('invalid',e=>{const card=e.target.closest('[data-coaching]');if(card)card.open=true;},true);
  sync();
}
