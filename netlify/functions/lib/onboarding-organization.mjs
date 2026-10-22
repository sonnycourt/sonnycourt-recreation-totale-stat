import {isUuid} from './onboarding-domain.mjs';

export const ARCHIVE_REASONS = {abandon:'Abandon',unfinished:'Dossier non finalisé',other:'Autre'};
export const MEETING_KEYS = ['onboarding','coaching1','coaching2','coaching3'];
export const emptyOrganization = () => ({version:0,archived_at:null,archive_reason:'',time_zone:'',meeting_links:{}});
export function validTimeZone(value) {
  if(typeof value!=='string'||value.length>100)return false;
  if(!value)return true;
  try { new Intl.DateTimeFormat('fr',{timeZone:value}).format();return true; } catch { return false; }
}
export function validMeetingLink(value) {
  if(typeof value!=='string'||value.length>1000)return false;
  if(!value)return true;
  try { const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password; } catch { return false; }
}
export function validateOrganization(body) {
  if(body?.action!=='organization'||!isUuid(body.case_id)||!isUuid(body.command_id)
    ||!Number.isSafeInteger(body.version)||body.version<0)return false;
  const p=body.patch;
  if(!p||typeof p!=='object'||Array.isArray(p)||!Object.keys(p).length)return false;
  return Object.entries(p).every(([key,value])=>{
    if(key==='archived')return typeof value==='boolean' && (!value||Object.hasOwn(ARCHIVE_REASONS,p.archive_reason));
    if(key==='archive_reason')return value===''||Object.hasOwn(ARCHIVE_REASONS,value);
    if(key==='time_zone')return validTimeZone(value);
    if(key==='meeting_links')return value&&typeof value==='object'&&!Array.isArray(value)
      &&Object.entries(value).every(([k,v])=>MEETING_KEYS.includes(k)&&validMeetingLink(v));
    return false;
  });
}

// Les IDs proviennent exclusivement de dossiers déjà filtrés par coach.
// Une panne ne doit pas faire réapparaître des dossiers archivés comme actifs.
export async function withOrganization(db,rows,scope) {
  if(!rows.length)return {rows,ready:true};
  const byId=new Map();
  try {
    for(let start=0;start<rows.length;start+=200){
      const ids=rows.slice(start,start+200).map(r=>r.id);
      if(!ids.every(isUuid))throw Error('invalid case');
      const records=await db(`onboarding_cases?id=in.(${ids.join(',')})${scope}&select=id,organization:onboarding_case_organization(version,archived_at,archive_reason,time_zone,meeting_links)`);
      if(!Array.isArray(records))throw Error('organization unavailable');
      for(const r of records){const meta=Array.isArray(r.organization)?r.organization[0]:r.organization;byId.set(r.id,meta||emptyOrganization());}
      if(ids.some(id=>!byId.has(id)))throw Error('organization scope changed');
    }
  } catch(error) {
    if(!error.missingRelation)throw error;
    return {rows:rows.map(r=>({...r,organization:null})),ready:false};
  }
  return {rows:rows.map(r=>({...r,organization:byId.get(r.id)})),ready:true};
}

const offsetMinutes=(zone,date)=>{
  const parts=new Intl.DateTimeFormat('en',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(date);
  const name=parts.find(p=>p.type==='timeZoneName').value;
  const match=name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match?(match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3])):0;
};
export function timeZoneSummary(zone,at=Date.now()) {
  if(!zone||!validTimeZone(zone)||!Number.isFinite(new Date(at).getTime()))return null;
  const date=new Date(at),difference=offsetMinutes(zone,date)-offsetMinutes('Europe/Paris',date);
  const minutes=Math.abs(difference),hours=Math.floor(minutes/60),rest=minutes%60;
  return {zone,difference,local:new Intl.DateTimeFormat('fr-FR',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(date),
    paris:new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'}).format(date),
    label:difference===0?'Même heure que Paris':`${difference>0?'+':'−'}${hours} h${rest?' '+String(rest).padStart(2,'0'):''} par rapport à Paris`};
}
