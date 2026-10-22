import {isUuid,parisDay} from './onboarding-domain.mjs';
import {coachingSlots} from './onboarding-coachings.mjs';
import {withOrganization} from './onboarding-organization.mjs';

export function validAgendaRange(from,to) {
  const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)
    &&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
  return valid(from)&&valid(to)&&to>=from&&(Date.parse(to)-Date.parse(from))<=42*86400000;
}
export function agendaEvents(rows,sessions,{from,to}) {
  const events=[];
  for(const row of rows){
    if(row.organization?.archived_at)continue;
    const add=(key,label,at,status)=>{
      if(!at||!Number.isFinite(Date.parse(at)))return;
      const day=parisDay(at);if(day<from||day>to)return;
      events.push({id:`${row.id}:${key}`,case_id:row.id,name:row.preferred_name||row.display_name,email:row.email,
        key,label,at,day,status,time_zone:row.organization?.time_zone||'',meeting_link:row.organization?.meeting_links?.[key]||''});
    };
    if(row.status==='booked')add('onboarding','Onboarding',row.onboarding_at,'planned');
    for(const slot of coachingSlots(row,sessions.filter(s=>s.case_id===row.id))){
      if(slot.status==='planned')add(`coaching${slot.number}`,`Coaching ${slot.number}`,slot.scheduled_at,slot.status);
    }
  }
  return events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
}
export async function loadAgenda(db,scope,range) {
  const rows=[];
  const select='id,display_name,preferred_name,email,status,onboarding_at,coaching_at,coaching_booked';
  for(let offset=0;;offset=rows.length){
    const batch=await db(`onboarding_cases?select=${select}${scope}&order=id.asc&limit=1000&offset=${offset}`);
    if(!Array.isArray(batch))throw Error('agenda unavailable');
    if(!batch.length)break;
    rows.push(...batch);if(rows.length>10000)throw Error('agenda limit');
  }
  const organized=await withOrganization(db,rows,scope),sessions=[];
  for(let start=0;start<rows.length;start+=200){
    const ids=rows.slice(start,start+200).map(r=>r.id);
    if(!ids.every(isUuid))throw Error('invalid case');
    const records=await db(`onboarding_cases?id=in.(${ids.join(',')})${scope}&select=id,sessions:onboarding_coaching_sessions(number,status,scheduled_at)`);
    if(!Array.isArray(records)||records.length!==ids.length)throw Error('agenda changed');
    for(const r of records){
      if(!Array.isArray(r.sessions))throw Error('agenda sessions unavailable');
      sessions.push(...r.sessions.map(s=>({...s,case_id:r.id})));
    }
  }
  return {events:agendaEvents(organized.rows,sessions,range),organizationReady:organized.ready,...range};
}
