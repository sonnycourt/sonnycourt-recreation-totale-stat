// Création du seul groupe demandé. Aucun abonné, email ou automatisation.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url))).siteId;
const env=JSON.parse(execFileSync('npx',['netlify','env:list','--context','production','--json','--site',site],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(!env.MAILERLITE_API_KEY)throw new Error('MailerLite non configuré');
const name='Lead Magnet — Papa, raconte-moi';
async function api(path,options={}){
  const res=await fetch(`https://connect.mailerlite.com/api${path}`,{...options,headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw new Error(`MailerLite HTTP ${res.status}`);
  return res.json();
}
const groups=[];
for(let page=1;page<=100;page++){
  const data=await api(`/groups?limit=100&page=${page}&filter[name]=${encodeURIComponent(name)}`);
  groups.push(...data.data);
  if(!data.links?.next)break;
  if(page===100)throw new Error('Pagination incomplète');
}
const matches=groups.filter(g=>g.name===name);
if(matches.length>1)throw new Error('Groupes ambigus');
const created=!matches.length;
const group=matches[0]||(await api('/groups',{method:'POST',body:JSON.stringify({name})})).data;
if(!/^\d+$/.test(String(group?.id)))throw new Error('Groupe invalide');
const verified=(await api(`/groups/${group.id}`)).data;
console.log(JSON.stringify({id:verified.id,name:verified.name,created,active_count:verified.active_count}));
