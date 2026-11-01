const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(`${value.slice(0,10)}T12:00:00Z`)) : '';
export function sonnyFeedbackMarkup(data) {
  let content;
  if (!data?.ready) content = '<p>Les retours de Sonny sont momentanément indisponibles ou pas encore activés. Les autres informations de la fiche restent accessibles.</p>';
  else if (!data.replies.length) content = '<p>Aucun retour de Sonny enregistré pour cet email. Cela ne signifie pas qu’aucun échange n’a eu lieu par email.</p>';
  else content = data.replies.map((r,i)=>`<details ${i===0?'open':''}><summary>Retour du ${esc(date(r.answered_on))}</summary><h4>La demande de l’élève</h4><div class="sonny-text">${esc(r.question)}</div><h4>Le retour de Sonny</h4><div class="sonny-text sonny-answer">${esc(r.answer)}</div></details>`).join('') + (data.more ? '<p>Les 100 retours les plus récents sont affichés.</p>' : '');
  return `<section id="sonny-feedback" class="detail-section sonny-feedback"><div class="section-heading"><h3>Bilan personnel avec Sonny</h3><small>Lecture seule · continuité du coaching</small></div>${content}</section>`;
}
export const demoSonnyReply = {id:'00000000-0000-4000-8000-000000000091',feedback_id:1,email:'demo1@example.com',prenom:'Camille Martin',question:'Je comprends les exercices, mais je ne les pratique pas régulièrement. Comment installer une routine sans me mettre la pression ?',answer:'Bonjour Camille,\n\nCommence par choisir un seul exercice et un moment simple dans ta journée. L’objectif cette semaine est de retrouver de la régularité, pas de tout faire.\n\nAvec Romain, tu pourras identifier ce qui rend ce rendez-vous avec toi-même plus facile à tenir.\n\nSonny',answered_on:'2026-10-29',version:1};
