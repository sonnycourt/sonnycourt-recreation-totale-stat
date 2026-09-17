import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { validateCommand, plusDays, presentCase } from '../netlify/functions/lib/onboarding-domain.mjs';
import { createHandler } from '../netlify/functions/onboarding-crm.js';
import { signCloserToken, getCloserCookieSecret } from '../netlify/functions/lib/closer-access-crypto.mjs';

let checks=0;
function ok(value,message){assert.ok(value,message);checks++;}
const db=new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.closer_access_codes(id bigint primary key,label text,email text,password_hash text,active boolean);
insert into public.closer_access_codes values
  (22,'Romain','2romainorfila@gmail.com','hash',true),(20,'Sonny','sonnycourt@gmail.com','hash',true),
  (24,'Autre','other@example.test','hash',true),(25,'Recrutement',null,null,true);
create table public.mc2_registrations (
  id bigint primary key,token text,email text,prenom text,telephone text,pays text,statut text,
  initial_payment_cents integer,checkout_last_payment_mode text,purchased_at timestamptz,
  billing_full_name text,billing_phone text,billing_country text,billing_city text,
  payment_status text,paid_installment_count integer
);
create table public.mc2_tracking_test_registrations(token text);
create table public.webinaire_registrations(email text,telephone text,purchased_at timestamptz);
insert into public.mc2_registrations (id,token,email,prenom,telephone,pays,statut,initial_payment_cents,checkout_last_payment_mode,purchased_at,billing_full_name,billing_country,payment_status,paid_installment_count)
values (1,'p1','alice@example.test','Alice','+33100000000','France','purchased',0,'spiffy_j7_12x197','2026-09-15T22:09:00Z','Alice Martin','FR','paid',0);
insert into public.mc2_registrations select 2,'p2','six@example.test','Six',telephone,pays,statut,initial_payment_cents,'spiffy_j7_6x347',purchased_at,billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.mc2_registrations select 3,'p3','notbuyer@example.test','Non acheté',telephone,pays,'registered',0,checkout_last_payment_mode,null,billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.mc2_registrations select 4,'p4','demariae.cloer@vertexinbox.com','Sonny',telephone,pays,statut,0,checkout_last_payment_mode,purchased_at,billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.mc2_registrations select 5,'p5','testing@example.test','Sonny Test',telephone,pays,statut,0,checkout_last_payment_mode,purchased_at,billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.mc2_registrations select 6,'p6','excluded@example.test','Exclu',telephone,pays,statut,0,checkout_last_payment_mode,purchased_at,billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.mc2_tracking_test_registrations values ('p6');
insert into public.mc2_registrations select 7,'p7','old@example.test','Ancien',telephone,pays,statut,19700,'spiffy_12x197',purchased_at,billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.mc2_registrations select 8,'p8',' ALICE@example.test ','Doublon',telephone,pays,statut,0,checkout_last_payment_mode,purchased_at+interval '1 day',billing_full_name,billing_phone,billing_country,billing_city,payment_status,paid_installment_count from public.mc2_registrations where id=1;
insert into public.webinaire_registrations values ('leilast@hotmail.fr','+33000000000','2026-09-14T11:01:43Z');
`);
const original=JSON.stringify((await db.query('select * from public.mc2_registrations order by id')).rows);
const accounts=JSON.stringify((await db.query('select * from public.closer_access_codes order by id')).rows);
const migration=await fs.readFile(new URL('../sql/onboarding_crm.sql',import.meta.url),'utf8');
await db.exec(migration);await db.exec(migration);
ok((await db.query('select count(*)::int n from public.onboarding_cases')).rows[0].n===2,'idempotent sync, filters, dedup, six and twelve');
ok((await db.query('select count(*)::int n from public.onboarding_staff')).rows[0].n===2,'only two authorized accounts');
const history=await fs.readFile(new URL('../sql/onboarding_crm_history.sql',import.meta.url),'utf8');
await db.exec(history);await db.exec(history);
ok((await db.query('select count(*)::int n from public.onboarding_cases')).rows[0].n===3,'legacy seed idempotent');
const c=(await db.query("select * from public.onboarding_cases where email='alice@example.test'")).rows[0];
const save=async(actor,version,kind,patch={},command=randomUUID())=>(await db.query('select public.onboarding_save_case($1,$2,$3,$4,$5,$6,$7) c',[actor,c.id,version,command,patch,kind,'Note exemple'])).rows[0].c;
const command=randomUUID();const saved=await save(22,1,'call_no_answer',{goal:'Objectif personnel'},command);
ok(saved.status==='contacting'&&saved.next_action==='sms'&&saved.version===2,'call sets immediate SMS');
await save(22,1,'call_no_answer',{goal:'Objectif personnel'},command);
ok((await db.query('select count(*)::int n from public.onboarding_events')).rows[0].n===1,'network retry idempotent');
await assert.rejects(()=>save(22,1,'updated'),/onboarding_version_conflict/);checks++;
await assert.rejects(()=>save(24,2,'updated'),/onboarding_forbidden/);checks++;
await assert.rejects(()=>save(22,2,'updated',{assigned_closer_id:24}),/onboarding_invalid_field/);checks++;
await assert.rejects(()=>save(22,2,'updated',{coaching_at:'2026-09-20T10:00:00Z'}),/onboarding_coaching_too_early/);checks++;
await assert.rejects(()=>save(22,2,'updated',{notes:'a'.repeat(12001)}),/check constraint/);checks++;
ok((await db.query('select version from public.onboarding_cases where id=$1',[c.id])).rows[0].version===2,'failed write rolls back both state and audit');
const sms=await save(22,2,'sms_sent');
ok(sms.status==='awaiting'&&sms.next_action==='whatsapp'&&Math.abs(Date.parse(sms.followup_at)-Date.now()-86400000)<5000,'SMS schedules +24h');
const wa=await save(22,3,'whatsapp_sent');
ok(wa.status==='awaiting'&&wa.next_action==='followup'&&!wa.followup_at,'voice note no repeated automatic chase');
await save(22,4,'completed',{coaching_at:'2026-10-19T10:00:00Z'});
await db.exec('select public.onboarding_sync_cases()');
let current=(await db.query('select * from public.onboarding_cases where id=$1',[c.id])).rows[0];
ok(current.goal==='Objectif personnel'&&current.status==='done'&&current.version===5,'sync preserves notes, stages, version');
await db.query("update public.mc2_registrations set billing_phone='+33111111111' where id=1");
await db.exec('select public.onboarding_sync_cases()');
ok((await db.query('select phone from public.onboarding_cases where id=$1',[c.id])).rows[0].phone==='+33111111111','later billing information refreshed');
await db.query("update public.mc2_registrations set billing_phone=null where id=1");
await db.query('update public.onboarding_cases set assigned_closer_id=24 where id=$1',[c.id]);
await assert.rejects(()=>save(22,5,'updated'),/onboarding_forbidden/);checks++;
const list=async(actor,filter='all',search='',offset=0)=>(await db.query('select public.onboarding_list_cases($1,$2,$3,$4) d',[actor,filter,search,offset])).rows[0].d;
ok((await list(22)).total===2,'coach cannot read another assignment');
ok((await list(20)).total===3,'owner can supervise');
ok((await list(20,'all','France')).total===3,'search country label over ISO code');
ok((await list(20,'all','xxx')).total===0,'search empties honestly');
ok((await list(20,'all','',50)).cases.length===0,'pagination');
await assert.rejects(()=>list(24),/onboarding_forbidden/);checks++;
await save(20,5,'updated',{notes:'Note owner'});
await db.query('update public.closer_access_codes set active=false where id=22');
await assert.rejects(()=>list(22),/onboarding_forbidden/);checks++;
await db.query('update public.closer_access_codes set active=true where id=22');
for(const role of ['anon','authenticated']) {
  await db.exec(`set role ${role}`);
  await assert.rejects(()=>db.query('select * from public.onboarding_cases'),/permission denied/);checks++;
  await assert.rejects(()=>db.query('select public.onboarding_sync_cases()'),/permission denied/);checks++;
  await assert.rejects(()=>list(22),/permission denied/);checks++;
  await db.exec('reset role');
}
ok(original===JSON.stringify((await db.query('select * from public.mc2_registrations order by id')).rows),'no source registrations altered by CRM');
ok(accounts===JSON.stringify((await db.query('select * from public.closer_access_codes order by id')).rows),'no auth accounts altered by CRM');
ok(plusDays('2026-09-15T22:09:00Z',7)==='2026-09-23','Paris day across midnight');
ok(plusDays('2026-10-24T22:30:00Z',7)==='2026-11-01','DST calendar arithmetic');
ok(presentCase({...c,payment_date_override:'2026-10-14'}).first_payment_date==='2026-10-14','provider override wins');

const valid={case_id:c.id,version:1,command_id:randomUUID(),kind:'updated',note:'',patch:{goal:'Hello'}};
ok(validateCommand(valid),'valid payload');
ok(!validateCommand({...valid,patch:{assigned_closer_id:24}}),'reject reassign');
ok(!validateCommand({...valid,patch:{training_access:'true'}}),'strict booleans');
ok(!validateCommand({...valid,patch:{coaching_at:'not a date'}}),'strict timestamps');
process.env.SUPABASE_SERVICE_ROLE_KEY='local-smoke-only-key';
const signed=signCloserToken(getCloserCookieSecret(),60000,22);
const calls=[];
const mock=async(path,body)=>{
  calls.push([path,body]);
  if(path.startsWith('closer_access_codes'))return [{id:22,email:'coach@example.test',password_hash:'hash',label:'Romain'}];
  if(path.startsWith('onboarding_staff'))return [{role:'coach'}];
  if(path.startsWith('onboarding_cases'))return path.includes('assigned_closer_id=eq.22')?[c]:[];
  if(path.startsWith('onboarding_events'))return [];
  if(path==='rpc/onboarding_sync_cases')return 0;
  if(path==='rpc/onboarding_list_cases')return {cases:[c],total:1,counts:{all:1}};
  if(path==='rpc/onboarding_save_case')return c;
  throw new Error('unexpected');
};
const handler=createHandler(mock);
function request({cookie=true,headers={},method='GET',body,path=''}={}) {return new Request(`https://site.test/.netlify/functions/onboarding-crm${path}`,{method,headers:{'x-onboarding-client':'1',...(cookie?{cookie:`closer_access=${signed}`}:{ }),...headers},...(body?{body:JSON.stringify(body)}:{})});}
ok((await handler(request({cookie:false}))).status===401&&calls.length===0,'unauthenticated: zero DB calls');
ok((await handler(request({headers:{origin:'https://evil.test'}}))).status===403,'cross-origin rejected');
ok((await handler(request({headers:{'x-onboarding-client':''}}))).status===403,'simple requests rejected');
const listResponse=await handler(request());ok(listResponse.status===200&&listResponse.headers.get('cache-control').includes('no-store'),'authenticated list no cache');
ok((await handler(request({path:`?id=${c.id}`}))).status===200,'detail scoped query');
ok((await handler(request({method:'POST',headers:{'content-type':'application/json'},body:{...valid,patch:{source:'evil'}}}))).status===400,'HTTP rejects immutable changes');
const response=await handler(request({method:'POST',headers:{'content-type':'application/json'},body:valid}));
ok(response.status===200&&calls.at(-1)[1].p_actor===22,'actor comes from signed session, not payload');
const unavailable=createHandler(async(path,body)=>{if(path==='rpc/onboarding_sync_cases')throw new Error('offline');return mock(path,body);});
ok((await (await unavailable(request())).json()).syncWarning===true,'sync outage keeps existing cases usable');
ok((await createHandler(async(path)=>path.startsWith('closer_access_codes')?[{email:'x',password_hash:null}]:[])(request())).status===401,'recruitment code is not a login');
await db.close();
console.log(`Onboarding CRM : ${checks} vérifications réussies (base locale éphémère, aucune communication).`);
