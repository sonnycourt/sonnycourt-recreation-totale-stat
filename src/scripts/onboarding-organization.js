import {ARCHIVE_REASONS,MEETING_KEYS,emptyOrganization,timeZoneSummary,validTimeZone,validMeetingLink} from '../../netlify/functions/lib/onboarding-organization.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={onboarding:'Onboarding',coaching1:'Coaching 1',coaching2:'Coaching 2',coaching3:'Coaching 3'};
export function organizationMarkup(row,ready) {
  if(!ready)return '<section class="detail-section organization"><h3>Organisation</h3><p class="small">Archivage, fuseaux et liens en attente d’activation. Les notes restent accessibles.</p></section>';
  const org=row.organization||emptyOrganization(),zone=timeZoneSummary(org.time_zone),archived=!!org.archived_at;
  let zones=Intl.supportedValuesOf?.('timeZone')||['Europe/Paris','Europe/Zurich','America/Toronto','Africa/Casablanca','Indian/Reunion'];
  return `<section class="detail-section organization"><div class="section-heading"><h3>Organisation</h3><span class="tag ${archived?'paused':''}">${archived?'Archivé':'Dossier actif'}</span></div>
    ${archived?`<p class="notice">Dossier archivé · ${esc(ARCHIVE_REASONS[org.archive_reason]||'Autre')}. Notes, historique et coachings conservés.</p>`:''}
    <p class="student-time" id="student-time">${zone?`${esc(zone.local)} chez l’élève · ${esc(zone.label)}`:'Fuseau de l’élève à renseigner · aucune heure déduite du pays.'}</p>
    <details id="organization-settings"><summary>Fuseau horaire et liens de visioconférence</summary>
      <form id="organization-form"><label>Fuseau confirmé avec l’élève<input name="time_zone" list="student-zones" maxlength="100" value="${esc(org.time_zone)}" placeholder="Ex. Europe/Paris ou America/Toronto" autocomplete="off" /><datalist id="student-zones">${zones.map(z=>`<option value="${esc(z)}"></option>`).join('')}</datalist><small>L’heure affichée tient compte des changements d’heure à la date du rendez-vous.</small></label>
      <div class="meeting-fields">${MEETING_KEYS.map(key=>`<label>${labels[key]} · lien visio<input name="${key}" type="url" placeholder="https://meet.google.com/…" maxlength="1000" value="${esc(org.meeting_links[key])}" />${org.meeting_links[key]&&validMeetingLink(org.meeting_links[key])?`<a href="${esc(org.meeting_links[key])}" target="_blank" rel="noopener noreferrer">Ouvrir la visio ↗</a>`:''}</label>`).join('')}</div>
      <p class="small">Liens enregistrés ici uniquement. Aucune invitation ni aucun email automatique.</p>
      <div class="actions"><button type="submit" class="secondary">Enregistrer l’organisation</button><span id="organization-state" role="status"></span></div></form>
    </details>
    <details class="archive-settings"><summary>${archived?'Restaurer ce dossier':'Archiver ce dossier'}</summary><p class="small">${archived?'Le dossier retrouvera son classement précédent.':'Le dossier disparaîtra des listes actives et de l’agenda. Aucun accès élève ni paiement ne sera modifié.'}</p>
      ${archived?'':`<label>Motif<select id="archive-reason">${Object.entries(ARCHIVE_REASONS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`}
      <button id="archive-case" type="button" class="secondary">${archived?'Restaurer le dossier':'Archiver sans supprimer'}</button>
    </details><p id="organization-error" class="dialog-error" role="alert" hidden></p></section>`;
}
export function organizationPatch(form) {
  const zone=form.elements.time_zone.value.trim();
  form.elements.time_zone.setCustomValidity(validTimeZone(zone)?'':'Choisis un fuseau valide dans la liste.');
  const links={};
  for(const key of MEETING_KEYS){const input=form.elements[key],value=input.value.trim();input.setCustomValidity(validMeetingLink(value)?'':'Utilise un lien HTTPS complet, sans identifiant ni mot de passe.');links[key]=value;}
  if(!form.reportValidity())return null;
  return {time_zone:zone,meeting_links:links};
}
