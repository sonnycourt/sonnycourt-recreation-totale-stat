import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url),'utf8')).siteId;
function cli(args){return execFileSync('npx',['netlify',...args,'--site',site],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
const env=JSON.parse(cli(['env:list','--context','production','--json']));
if(!env.MAILERLITE_API_KEY)throw new Error('MailerLite non configuré');
async function api(path,options={}){
 const res=await fetch(`https://connect.mailerlite.com/api${path}`,{...options,headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,'Content-Type':'application/json',Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw new Error(`MailerLite HTTP ${res.status}`);
 return res.json();
}
const groups=[];
for(let page=1;page<=100;page++){
 const data=await api(`/groups?limit=100&page=${page}`);groups.push(...data.data);
 if(!data.links?.next)break;
 if(page===100)throw new Error('Pagination incomplète');
}
for(const [name,key]of [['DeltaVision Inscription','MAILERLITE_GROUP_DELTA_VISION_REGISTRATIONS'],['DeltaVision Acheteurs','MAILERLITE_GROUP_DELTA_VISION_BUYERS']]){
 let group=groups.find(g=>g.name===name);
 if(!group)group=(await api('/groups',{method:'POST',body:JSON.stringify({name})})).data;
 if(!group?.id)throw new Error('Groupe absent');
 cli(['env:set',key,String(group.id),'--scope','functions','--force']);
 console.log(`${name}: configuré (membres: ${group.active_count ?? 'non renseigné'})`);
}
if(!env.DELTA_VISION_SPIFFY_WEBHOOK_TOKEN){cli(['env:set','DELTA_VISION_SPIFFY_WEBHOOK_TOKEN',randomBytes(32).toString('hex'),'--scope','functions','--force']);}
console.log('Groupes prêts. Aucune automation email créée ou activée. Secret webhook configuré, non affiché.');
