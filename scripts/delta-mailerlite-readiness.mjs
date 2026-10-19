import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const site=JSON.parse(readFileSync(new URL('../deploy/critical-routes.json',import.meta.url))).siteId;
const env=JSON.parse(execFileSync('npx',['netlify','env:list','--context','production','--json','--site',site],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
async function get(path){const r=await fetch('https://connect.mailerlite.com/api'+path,{headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json'}});if(!r.ok)throw Error(`MailerLite ${r.status}`);return r.json();}
const groups=[];for(let page=1;page<=100;page++){const r=await get(`/groups?limit=100&page=${page}`);groups.push(...r.data);if(!r.links?.next)break;}
console.log(JSON.stringify({configuredRegistration:env.MAILERLITE_GROUP_DELTA_VISION_REGISTRATIONS,configuredBuyers:env.MAILERLITE_GROUP_DELTA_VISION_BUYERS,groups:groups.filter(g=>/delta/i.test(g.name)).map(g=>({id:g.id,name:g.name,total:g.total,active_count:g.active_count}))},null,2));
const automations=await get('/automations?limit=100');
console.log(JSON.stringify({automations:automations.data.filter(a=>/delta/i.test(a.name)).map(a=>({id:a.id,name:a.name,enabled:a.enabled,triggers:a.triggers})),pagination:automations.links},null,2));
if(process.argv.includes('--restore-registration-group')){
 let group=groups.find(g=>g.name==='DeltaVision Inscription');
 if(!group){const r=await fetch('https://connect.mailerlite.com/api/groups',{method:'POST',headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({name:'DeltaVision Inscription'})});if(!r.ok)throw Error(`Group creation ${r.status}`);group=(await r.json()).data;}
 if(!/^\d+$/.test(String(group?.id)))throw Error('Invalid group');
 execFileSync('npx',['netlify','env:set','MAILERLITE_GROUP_DELTA_VISION_REGISTRATIONS',String(group.id),'--scope','functions','--force','--site',site],{stdio:['ignore','pipe','pipe']});
 console.log(JSON.stringify({registrationGroupRestored:group.id,name:group.name,noSubscribersAdded:true,noAutomationsCreated:true}));
}
