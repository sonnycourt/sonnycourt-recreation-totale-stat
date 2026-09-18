// Les choix simples remplissent les champs existants ; aucune donnée n'est effacée
// lorsque le coach conserve la prochaine étape actuelle.
export function workflowPatch(choice,dates){
  if(choice==='booked')return {status:'booked',next_action:'onboarding',onboarding_at:dates.onboarding_at,followup_at:dates.onboarding_at};
  if(choice==='followup')return {status:'contacting',next_action:'followup',followup_at:dates.followup_at};
  if(choice==='done')return {status:'done',next_action:'none',followup_at:null};
  if(choice==='paused')return {status:'paused',next_action:'none',followup_at:null};
  return {};
}
