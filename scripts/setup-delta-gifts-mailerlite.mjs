import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url))).siteId;
const cli=args=>execFileSync('npx',['netlify',...args,'--site',site],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const env=JSON.parse(cli(['env:list','--context','production','--json']));
if(!env.MAILERLITE_API_KEY)throw new Error('MailerLite non configuré');
const name='Delta Vision — Cadeaux reçus';
async function api(path,options={}){
 const response=await fetch(`https://connect.mailerlite.com/api${path}`,{...options,headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error(`MailerLite HTTP ${response.status}`);
 return response.json();
}
let group;
for(let page=1;page<=100;page++){
 const result=await api(`/groups?limit=100&page=${page}`);
 group=result.data.find(g=>g.name===name);
 if(group || !result.links?.next)break;
 if(page===100)throw new Error('Pagination incomplète');
}
if(!group)group=(await api('/groups',{method:'POST',body:JSON.stringify({name})})).data;
if(!/^\d+$/.test(String(group?.id || '')))throw new Error('Groupe absent');
cli(['env:set','MAILERLITE_GROUP_DELTA_VISION_GIFTS',String(group.id),'--scope','functions','--force']);
console.log('Groupe Cadeaux reçus configuré. Aucun contact ajouté, aucun email envoyé, aucune séquence créée ou activée.');
