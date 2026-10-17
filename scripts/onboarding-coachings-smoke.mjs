import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {coachingSlots,validateCoachings} from '../netlify/functions/lib/onboarding-coachings.mjs';
import {createHandler} from '../netlify/functions/onboarding-crm.js';
import {signCloserToken,getCloserCookieSecret} from '../netlify/functions/lib/closer-access-crypto.mjs';

const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table closer_access_codes(id bigint primary key,label text,email text,password_hash text,active boolean);
insert into closer_access_codes values(22,'Romain','2romainorfila@gmail.com','local',true),(20,'Sonny','sonnycourt@gmail.com','local',true),(24,'Autre','other@example.test','local',true);
create table mc2_tracking_test_registrations(token text);
create table mc2_registrations(id bigint,token text,email text,prenom text,billing_full_name text,billing_phone text,telephone text,billing_country text,pays text,billing_city text,purchased_at timestamptz,statut text,initial_payment_cents integer,checkout_last_payment_mode text,payment_status text,paid_installment_count integer);
`);
for(const file of ['onboarding_crm.sql','onboarding_crm_contact_history.sql','onboarding_whatsapp_received.sql'])await db.exec(await readFile(new URL(`../sql/${file}`,import.meta.url),'utf8'));
await db.exec(`insert into onboarding_staff(closer_id,role) values(24,'coach');
insert into onboarding_cases(email,source,assigned_closer_id,display_name,purchased_at,plan,notes,coaching_at,coaching_booked)
values('fiction@example.test','mc2',22,'Élève fictif',now()-interval '80 days','twelve','Onboarding conservé',now()-interval '20 days',true);`);
let c=JSON.parse(JSON.stringify((await db.query('select * from onboarding_cases')).rows[0]));
const before=JSON.stringify(c);
const sql=await readFile(new URL('../sql/onboarding_coaching_sessions.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);
assert.equal(JSON.stringify((await db.query('select * from onboarding_cases')).rows[0]),before,'migration additive, ne touche aucune fiche');
let sessions=coachingSlots(c);
assert.equal(sessions[0].status,'planned');
assert.equal(sessions[0].scheduled_at,c.coaching_at);
assert.equal(sessions.length,3);
const patch={coaching_at:c.coaching_at};
sessions[0]={...sessions[0],status:'completed',duration_minutes:60,notes:'Objectif, prise de conscience, prochain pas.'};
sessions[1]={...sessions[1],status:'planned',scheduled_at:new Date(Date.now()+86400000).toISOString()};
assert.ok(validateCoachings(sessions,patch));
for(const bad of [sessions.slice(0,2),[...sessions,sessions[0]],sessions.map(s=>({...s,number:1})),sessions.map(s=>({...s,notes:1})),sessions.map(s=>({...s,duration_minutes:0})),sessions.map(s=>({...s,unexpected:true}))])assert.equal(validateCoachings(bad,patch),false);
const future=sessions.map(s=>({...s,scheduled_at:new Date(Date.now()+86400000).toISOString()}));
assert.equal(validateCoachings(future,{coaching_at:future[0].scheduled_at}),false);
const save=async({actor=22,version=c.version,command=randomUUID(),items=sessions,changes=patch}={})=>(await db.query('select onboarding_save_with_coachings($1,$2,$3,$4,$5,$6,$7,$8,$9) d',[actor,c.id,version,command,changes,'updated','',new Date().toISOString(),items])).rows[0].d;
const command=randomUUID();
let saved=await save({command});
assert.equal(saved.case.notes,'Onboarding conservé');
assert.equal(saved.case.version,2);assert.equal(saved.coachings.length,3);
assert.equal(saved.coachings[0].scheduled_at,null,'première date canonique, jamais dupliquée');
assert.equal(saved.coachings[0].notes,sessions[0].notes);
await save({command});
assert.equal((await db.query('select count(*)::int n from onboarding_coaching_revisions')).rows[0].n,1,'retry sans double écriture');
await assert.rejects(()=>save(),/onboarding_version_conflict/);
await assert.rejects(()=>save({actor:24,version:2}),/onboarding_forbidden/);
const snapshot=JSON.stringify((await db.query('select * from onboarding_coaching_sessions order by number')).rows);
const bad=sessions.map(s=>({...s}));bad[2].notes='x'.repeat(6001);
await assert.rejects(()=>save({version:2,items:bad,changes:{...patch,notes:'Ne doit pas passer'}}),/onboarding_invalid_coaching/);
assert.equal((await db.query('select notes from onboarding_cases')).rows[0].notes,'Onboarding conservé','rollback intégral accueil + coaching');
assert.equal(JSON.stringify((await db.query('select * from onboarding_coaching_sessions order by number')).rows),snapshot);
await assert.rejects(()=>save({version:2,items:sessions.map(s=>({...s,duration_minutes:1.5}))}),/onboarding_invalid_coaching/);
await assert.rejects(()=>save({version:2,items:future,changes:{coaching_at:future[0].scheduled_at}}),/onboarding_invalid_coaching/);
saved=await save({actor:20,version:2});assert.equal(saved.case.version,3,'owner autorisé');
// Une ancienne interface peut continuer à enregistrer sans toucher aux notes des trois séances.
await db.query('select onboarding_save_case_v2($1,$2,$3,$4,$5,$6,$7,$8)',[22,c.id,3,randomUUID(),{goal:'Objectif depuis ancienne interface'},'updated','',new Date().toISOString()]);
assert.equal((await db.query('select notes from onboarding_coaching_sessions where number=1')).rows[0].notes,sessions[0].notes);
// Retry après une autre sauvegarde retourne les notes actuelles, pas le vieux brouillon.
const newer=sessions.map(s=>({...s,notes:'Version actuelle'}));
await save({version:4,items:newer});
assert.equal((await save({command})).coachings[0].notes,'Version actuelle');
for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from onboarding_coaching_sessions'),/permission denied/);
  await assert.rejects(()=>db.query('select * from onboarding_coaching_revisions'),/permission denied/);
  await assert.rejects(()=>save({version:5}),/permission denied/);
  await db.exec('reset role');
}
await db.exec(sql);
assert.equal((await db.query('select notes from onboarding_coaching_sessions where number=1')).rows[0].notes,'Version actuelle','migration réexécutée sans perte');
await db.exec('grant select on closer_access_codes to service_role; set role service_role');
assert.equal((await save({version:5,items:newer})).case.version,6,'vraies permissions du rôle serveur, sans privilège propriétaire');
await db.exec('reset role');

// API : autorisation avant lecture des séances, refus des payloads invalides et compatibilité.
process.env.SUPABASE_SERVICE_ROLE_KEY='local-test-only';
const signed=signCloserToken(getCloserCookieSecret(),60000,22),calls=[];
let missing=false,denied=false;
const mock=async(path,body)=>{
  calls.push([path,body]);
  if(path.startsWith('closer_access_codes'))return [{email:'coach@example.test',password_hash:'local'}];
  if(path.startsWith('onboarding_staff'))return [{role:'coach'}];
  if(path.startsWith('onboarding_cases'))return denied?[]:[c];
  if(path.startsWith('onboarding_events'))return [];
  if(path.startsWith('onboarding_coaching_sessions')){if(missing)throw Error('missing migration');return sessions;}
  if(path==='rpc/onboarding_save_with_coachings')return {case:c,coachings:sessions};
  if(path==='rpc/onboarding_save_case_v2')return c;
  throw Error('unexpected');
};
const handler=createHandler(mock);
const req=(body)=>new Request(`https://site.test/.netlify/functions/onboarding-crm?id=${c.id}`,{method:body?'POST':'GET',headers:{cookie:`closer_access=${signed}`,'x-onboarding-client':'1','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
assert.equal((await(await handler(req())).json()).coachings.length,3);
assert.ok(calls.some(([path])=>path.includes('assigned_closer_id=eq.22')));
missing=true;assert.equal((await(await handler(req())).json()).coachings,null,'accueil disponible sans nouvelle table');missing=false;
denied=true;const start=calls.length;assert.equal((await handler(req())).status,404);
assert.equal(calls.slice(start).some(([path])=>path.startsWith('onboarding_coaching_sessions')),false,'aucune lecture de notes hors périmètre');denied=false;
const body={case_id:c.id,version:1,command_id:randomUUID(),kind:'updated',note:'',patch,coachings:sessions,p_actor:20};
assert.equal((await handler(req(body))).status,200);
assert.equal(calls.findLast(([path])=>path==='rpc/onboarding_save_with_coachings')[1].p_actor,22);
assert.equal((await handler(req({...body,coachings:[]}))).status,400);
const {coachings,...legacy}=body;assert.equal((await handler(req(legacy))).status,200);
assert.equal(calls.findLast(([path])=>path.startsWith('rpc/'))[0],'rpc/onboarding_save_case_v2');
await db.close();
console.log('PASS coachings : migration x3, données préservées, 3 séances, atomicité, retries, conflits, droits, historique, anciennes interfaces et API. Aucun réseau ni donnée réelle.');
