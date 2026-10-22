import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {contactStep} from '../netlify/functions/lib/onboarding-domain.mjs';
import {emptyOrganization,validateOrganization,withOrganization,timeZoneSummary,validMeetingLink} from '../netlify/functions/lib/onboarding-organization.mjs';
import {countryGroupPage} from '../netlify/functions/lib/onboarding-country-groups.mjs';
import {agendaEvents,validAgendaRange,loadAgenda} from '../netlify/functions/lib/onboarding-agenda.mjs';
import {renderAgenda,agendaWeek} from '../src/scripts/onboarding-agenda.js';
import {organizationMarkup} from '../src/scripts/onboarding-organization.js';
import {createHandler} from '../netlify/functions/onboarding-crm.js';
import {signCloserToken,getCloserCookieSecret} from '../netlify/functions/lib/closer-access-crypto.mjs';

// Aucune connexion à une base réelle, aucun envoi externe.
globalThis.fetch=async()=>{throw Error('Network forbidden in this test');};
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table closer_access_codes(id bigint primary key,label text,email text,password_hash text,active boolean);
insert into closer_access_codes values(22,'Romain','2romainorfila@gmail.com','local',true),(20,'Sonny','sonnycourt@gmail.com','local',true),(24,'Autre','other@example.test','local',true);
create table mc2_tracking_test_registrations(token text);
create table mc2_registrations(id bigint,token text,email text,prenom text,billing_full_name text,billing_phone text,telephone text,billing_country text,pays text,billing_city text,purchased_at timestamptz,statut text,initial_payment_cents integer,checkout_last_payment_mode text,payment_status text,paid_installment_count integer);`);
for(const file of ['onboarding_crm.sql','onboarding_crm_contact_history.sql','onboarding_whatsapp_received.sql','onboarding_coaching_sessions.sql'])await db.exec(await readFile(new URL(`../sql/${file}`,import.meta.url),'utf8'));
await db.exec(`insert into onboarding_staff(closer_id,role) values(24,'coach');
insert into onboarding_cases(email,source,assigned_closer_id,display_name,purchased_at,plan,notes,status)
values('fiction@example.test','mc2',22,'Élève fictif',now()-interval '80 days','twelve','Notes essentielles à conserver','done');`);
const c=(await db.query('select * from onboarding_cases')).rows[0];
const caseBefore=JSON.stringify(c);
const sql=await readFile(new URL('../sql/onboarding_organization.sql',import.meta.url),'utf8');
// Trois anciens dossiers fictifs : deux réparables, un modifié après diagnostic.
const repairIds=['133464e0-c07c-4705-819e-afe6defded5d','35b94a01-f2b5-4f2b-ba56-229d7abe052e','daf599b7-b80b-45eb-a5f2-b3297c8e469c'];
for(const [index,id] of repairIds.entries()){
  await db.query(`insert into onboarding_cases(id,email,source,assigned_closer_id,display_name,purchased_at,plan,notes,status,next_action,version) values($1,$2,'mc2',22,'Ancien fictif',now(),'twelve','Notes historiques intactes','contacted','onboarding',$3)`,[id,`repair${index}@example.test`,[14,10,8][index]]);
  await db.query(`insert into onboarding_events(command_id,case_id,actor_id,kind,note) values($1,$2,22,'completed','Historique fictif')`,[randomUUID(),id]);
}
await db.exec(sql);await db.exec(sql);
const repairs=(await db.query('select id,status,version,notes from onboarding_cases where id=any($1::uuid[]) order by id',[repairIds])).rows;
assert.deepEqual(repairs.map(r=>r.status),['done','done','contacted']);
assert.deepEqual(repairs.map(r=>r.version),[15,11,8]);
assert.ok(repairs.every(r=>r.notes==='Notes historiques intactes'));
assert.equal((await db.query('select count(*)::int n from onboarding_status_repairs')).rows[0].n,2,'réparation bornée, journalisée et non répétée');
const originalCase=async()=>(await db.query('select * from onboarding_cases where id=$1',[c.id])).rows[0];
assert.equal(JSON.stringify(await originalCase()),caseBefore,'migration ne réécrit pas les autres fiches');
const save=async({actor=22,id=c.id,version=0,command=randomUUID(),patch={}}={})=>(await db.query('select onboarding_save_organization($1,$2,$3,$4,$5) data',[actor,id,version,command,patch])).rows[0].data;
const command=randomUUID();
let saved=await save({command,patch:{archived:true,archive_reason:'abandon',time_zone:'America/Toronto',meeting_links:{coaching1:'https://meet.google.com/abc-defg-hij'}}});
assert.ok(saved.archived_at);assert.equal(saved.version,1);
assert.equal(JSON.stringify(await originalCase()),caseBefore,'archivage ne touche ni notes ni dates ni statut');
await save({command,patch:{archived:true,archive_reason:'abandon'}});
assert.equal((await db.query('select count(*)::int n from onboarding_organization_revisions')).rows[0].n,1,'retry idempotent');
await assert.rejects(()=>save({patch:{archived:false}}),/onboarding_organization_conflict/);
await assert.rejects(()=>save({actor:24,version:1,patch:{archived:false}}),/onboarding_forbidden/);
await assert.rejects(()=>save({actor:24,command,version:1,patch:{archived:false}}),/onboarding_forbidden/);
for(const patch of [{notes:'ne pas toucher'},{time_zone:'invalid/zone'},{meeting_links:{coaching1:'javascript:alert(1)'}},{archived:true,archive_reason:'wrong'}])await assert.rejects(()=>save({version:1,patch}),/onboarding_invalid_organization/);
saved=await save({actor:20,version:1,patch:{archived:false}});assert.equal(saved.archived_at,null);assert.equal(saved.time_zone,'America/Toronto');
const current=await originalCase();
for(const kind of ['call_answered','contacted','whatsapp_received','call_no_answer','sms_sent','whatsapp_sent','unreachable','note']){
  const result=(await db.query('select onboarding_save_case_v2($1,$2,$3,$4,$5,$6,$7,$8) data',[22,c.id,current.version,randomUUID(),{status:'done'},kind,'Échange fictif',new Date().toISOString()])).rows[0].data;
  assert.equal(result.status,'done',kind+' ne régresse pas');current.version=result.version;
  assert.deepEqual(contactStep(kind,new Date().toISOString(),'done'),{});
}
const reopened=(await db.query('select onboarding_save_case_v2($1,$2,$3,$4,$5,$6,$7,$8) data',[22,c.id,current.version,randomUUID(),{status:'contacted'},'updated','',new Date().toISOString()])).rows[0].data;
assert.equal(reopened.status,'contacted','réouverture manuelle reste possible');
assert.equal(reopened.notes,c.notes);

// Rôle serveur réel et protection des archives.
await db.exec('grant select on closer_access_codes to service_role;set role service_role');
await save({version:2,patch:{time_zone:'Europe/Paris'}});
await assert.rejects(()=>db.exec('delete from onboarding_organization_revisions'),/permission denied/);
await assert.rejects(()=>db.exec('update onboarding_organization_revisions set before_data=null'),/permission denied/);
await db.exec('reset role');
for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from onboarding_case_organization'),/permission denied/);
  await assert.rejects(()=>save({version:3,patch:{archived:false}}),/permission denied/);
  await db.exec('reset role');
}
await db.exec(sql);
assert.equal((await db.query('select version from onboarding_case_organization')).rows[0].version,3,'réexécution sans écrasement');
await db.exec('revoke insert on onboarding_organization_revisions from service_role;set role service_role');
await assert.rejects(()=>save({version:3,patch:{archived:true,archive_reason:'unfinished'}}),/permission denied/);
await db.exec('reset role;grant insert on onboarding_organization_revisions to service_role');
assert.equal((await db.query('select version from onboarding_case_organization')).rows[0].version,3,'pas de changement sans journal');

// Classement et agenda : toutes les séances, sans notes ni archives.
const row={id:c.id,display_name:'Nom <script>',email:'fixture@example.test',status:'booked',onboarding_at:'2026-10-22T09:00:00Z',coaching_at:'2026-10-23T11:00:00Z',organization:{...emptyOrganization(),time_zone:'America/Toronto'}};
const sessions=[{case_id:c.id,number:2,status:'planned',scheduled_at:'2026-10-24T12:00:00Z'},{case_id:c.id,number:3,status:'cancelled',scheduled_at:'2026-10-25T12:00:00Z'}];
const range={from:'2026-10-19',to:'2026-10-25'},events=agendaEvents([row],sessions,range);
assert.equal(events.length,3);assert.deepEqual(events.map(e=>e.key),['onboarding','coaching1','coaching2']);
const archived={...row,organization:{...row.organization,archived_at:'2026-10-20T00:00:00Z'}};
assert.equal(agendaEvents([archived],sessions,range).length,0);
assert.equal(countryGroupPage([archived]).total,0);assert.equal(countryGroupPage([archived],{filter:'archived'}).total,1);
assert.equal(countryGroupPage([archived]).counts.archived,1);
assert.equal(agendaEvents([{...row,status:'done'}],sessions,range).length,2,'coaching après onboarding réalisé');
assert.equal(validAgendaRange('2026-02-30','2026-03-03'),false);assert.equal(validAgendaRange('2026-01-01','2026-12-31'),false);
assert.deepEqual(agendaWeek(Date.parse('2026-10-22T12:00:00Z')),range);
assert.equal(timeZoneSummary('America/Toronto','2026-10-22T12:00:00Z').difference,-360);
assert.equal(timeZoneSummary('America/Toronto','2026-10-26T12:00:00Z').difference,-300,'changements d’heure décalés entre France et Canada');
assert.equal(timeZoneSummary('Asia/Kathmandu','2026-12-01T12:00:00Z').difference,285);
assert.equal(timeZoneSummary(''),null);assert.equal(timeZoneSummary('wrong'),null);
assert.equal(validMeetingLink('https://user:password@example.test'),false);
const html=renderAgenda({...range,events,organizationReady:true});assert.ok(html.includes('Nom &lt;script&gt;'));assert.ok(!html.includes('Nom <script>'));
assert.ok(organizationMarkup(archived,true).includes('Restaurer le dossier'));
assert.ok(!validateOrganization({action:'organization',case_id:c.id,command_id:randomUUID(),version:0,patch:{notes:'wrong'}}));

let paths=[];
const metadata=async path=>{paths.push(path);assert.ok(path.includes('assigned_closer_id=eq.22'));if(path.includes('offset='))return path.includes('offset=0')?[row]:[];if(path.includes('organization:'))return [{id:c.id,organization:row.organization}];return [{id:c.id,sessions}];};
assert.equal((await loadAgenda(metadata,'&assigned_closer_id=eq.22',range)).events.length,3);
assert.ok(paths.every(p=>!p.includes('notes')));
await assert.rejects(()=>withOrganization(async()=>{throw Error('offline');},[row],''),/offline/);
assert.equal((await withOrganization(async()=>{throw Object.assign(Error('missing'),{missingRelation:true});},[row],'')).ready,false);

// API : aucun acteur fourni par le navigateur n'est cru.
process.env.SUPABASE_SERVICE_ROLE_KEY='organization-local-only';
const signed=signCloserToken(getCloserCookieSecret(),60000,22);let called;
const handler=createHandler(async(path,body)=>{
  if(path.startsWith('closer_access_codes'))return [{id:22,email:'coach@example.test',password_hash:'local'}];
  if(path.startsWith('onboarding_staff'))return [{role:'coach'}];
  if(path==='rpc/onboarding_save_organization'){called=body;return saved;}
  throw Error('unexpected');
});
const body={action:'organization',case_id:c.id,version:0,command_id:randomUUID(),patch:{time_zone:'Europe/Paris'},p_actor:20};
const req=(cookie=true,payload=body)=>new Request('https://site.test/.netlify/functions/onboarding-crm',{method:'POST',headers:{'x-onboarding-client':'1','content-type':'application/json',...(cookie?{cookie:`closer_access=${signed}`}:{})},body:JSON.stringify(payload)});
assert.equal((await handler(req(false))).status,401);assert.equal(called,undefined);
assert.equal((await handler(req())).status,200);assert.equal(called.p_actor,22);
assert.equal((await handler(req(true,{...body,patch:{notes:'unsafe'}}))).status,400);
await db.close();
console.log('PASS organisation CRM : migration réexécutable, notes intactes, archivage/restauration, autorisations, conflits, retries, journal obligatoire, statuts protégés, agenda complet, fuseaux DST, XSS et absence de réseau.');
