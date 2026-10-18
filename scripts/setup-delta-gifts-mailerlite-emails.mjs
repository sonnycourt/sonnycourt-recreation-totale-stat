// Creates empty groups and custom fields only. No subscriber, email or activation.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url))).siteId;
const env=JSON.parse(execFileSync('npx',['netlify','env:list','--context','production','--json','--site',site],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
if(!env.MAILERLITE_API_KEY)throw new Error('MailerLite API key missing');
async function api(path,body){
 const r=await fetch(`https://connect.mailerlite.com/api${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 const json=await r.json();if(!r.ok)throw new Error(`MailerLite ${r.status}`);return json;
}
async function list(path){const items=[];for(let page=1;page<=100;page++){const r=await api(`${path}?limit=100&page=${page}`);items.push(...r.data);if(!r.links?.next)return items;}throw new Error('Incomplete pagination');}
const groups=await list('/groups');
for(const name of ['Delta Vision — Acheteurs cadeaux','Delta Vision — Invitations cadeaux','Delta Vision — Renvoi lien acheteur','Delta Vision — Renvoi lien bénéficiaire']){
 const group=groups.find(g=>g.name===name)||(await api('/groups',{name})).data;
 console.log(JSON.stringify({type:'group',id:group.id,name:group.name}));
}
const fields=await list('/fields');
for(const name of ['dv_gift_owner_url','dv_gift_recipient_url','dv_gift_count','dv_gift_buyer_name']){
 const field=fields.find(f=>f.key===name)||(await api('/fields',{name,type:'text'})).data;
 console.log(JSON.stringify({type:'field',key:field.key,name:field.name}));
}
console.log('No subscriber added. No email sent. No automation activated.');
