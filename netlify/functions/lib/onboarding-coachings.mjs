// Trois séances privées. Le premier rendez-vous reste dans onboarding_cases.coaching_at.
export const COACHING_STATUSES = { pending:'À planifier', planned:'Planifié', completed:'Réalisé', absent:'Absent', cancelled:'Annulé' };
export function coachingSlots(row, saved = []) {
  return [1,2,3].map(number => {
    const s=saved.find(s=>s.number===number);
    const at=number===1 ? row.coaching_at || null : s?.scheduled_at || null;
    return {number, status:s?.status && !(s.status==='pending'&&at) ? s.status : (at || (number===1&&row.coaching_booked) ? 'planned':'pending'),
      scheduled_at:at, duration_minutes:s?.duration_minutes ?? null, notes:s?.notes || ''};
  });
}
export function validateCoachings(sessions, patch, now=Date.now()) {
  if(!Array.isArray(sessions)||sessions.length!==3)return false;
  return sessions.every((s,i)=>{
    if(!s || s.number!==i+1 || !Object.hasOwn(COACHING_STATUSES,s.status)
      || Object.keys(s).some(k=>!['number','status','scheduled_at','duration_minutes','notes'].includes(k))
      || typeof s.notes!=='string' || s.notes.length>6000)return false;
    if(s.scheduled_at!==null && (typeof s.scheduled_at!=='string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(s.scheduled_at)
      || !Number.isFinite(Date.parse(s.scheduled_at)) || Date.parse(s.scheduled_at)<Date.parse('2000-01-01')))return false;
    if(s.duration_minutes!==null && (!Number.isSafeInteger(s.duration_minutes)||s.duration_minutes<1||s.duration_minutes>240))return false;
    if(s.status==='pending'&&s.scheduled_at)return false;
    // Une ancienne séance marquée agendée sans date reste éditable sans inventer une date.
    if(['completed','absent','cancelled'].includes(s.status)&&!s.scheduled_at)return false;
    if(['completed','absent'].includes(s.status)&&Date.parse(s.scheduled_at)>now+300000)return false;
    if(s.status==='completed'&&s.duration_minutes===null)return false;
    if(s.number===1 && s.scheduled_at!==(patch.coaching_at ?? null))return false;
    return true;
  });
}
