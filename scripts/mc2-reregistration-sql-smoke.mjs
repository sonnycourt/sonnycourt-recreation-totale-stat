import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/package.json`);
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table mc2_registrations (
 id bigint primary key, token text unique, email text, purchased_at timestamptz,
 statut text, payment_status text, session_ends_at timestamptz,
 session_starts_at timestamptz, entry_payment_required boolean,
 session_slot_id text,slot_kind text,visitor_timezone text,
 registration_completed_at timestamptz,attended_live boolean,session_joined_at timestamptz,
 watch_first_second_live integer,watch_max_seconds_live integer,watch_max_seconds_replay integer,
 watch_max_minutes integer,saw_offer boolean,offer_expires_at timestamptz,
 clicked_cta boolean,cta_clicked_at timestamptz,last_presence_at timestamptz,
 updated_at timestamptz,registered_at timestamptz,utm_source text
);
create table mc2_tracking_events_v2(token text,event_name text);
create table webinaire_registrations(email text,purchased boolean,purchased_at timestamptz,statut text);
create table webinaire_exclusions(email text,raison text);
create table mc2_sms_jobs(id bigint,token text,status text,skip_reason text);
create table mc2_session_email_jobs(id bigint,token text,status text,skip_reason text);
create table mc2_replay_recovery_jobs(id bigint,token text,status text,skip_reason text);
`);
const history = readFileSync(new URL('../sql/mc2_reregistration_history.sql', import.meta.url),'utf8');
const transition = readFileSync(new URL('../sql/mc2_reregistration_transaction.sql', import.meta.url),'utf8');
await db.exec(history); await db.exec(transition); await db.exec(history); await db.exec(transition);
await db.exec(`insert into mc2_registrations(id,token,email,statut,session_starts_at,session_ends_at,registered_at,utm_source)
 values(1,'unit','unit@example.invalid','registered',now()-interval '2 days',now()-interval '1 day',now()-interval '3 days','meta');
 insert into mc2_sms_jobs values(1,'unit','pending',null);
 insert into mc2_session_email_jobs values(1,'unit','processing',null);`);
const session = { session_starts_at: new Date(Date.now()+3600000).toISOString(),
 session_ends_at: new Date(Date.now()+3*3600000).toISOString(), slot_kind:'scheduled',
 session_slot_id:'unit-slot',visitor_timezone:'Europe/Zurich' };
const call = () => db.query('select mc2_reregister_session($1,$2,$3) result',['unit',0,session]);
await assert.rejects(call(), /notification_in_flight/);
assert.equal((await db.query('select count(*)::int n from mc2_registration_history')).rows[0].n,0);
await db.exec("update mc2_session_email_jobs set status='pending'; insert into mc2_tracking_events_v2 values('unit','cta_playback_present');");
await assert.rejects(call(), /cta_playback/);
await db.exec('delete from mc2_tracking_events_v2');
await db.exec("update mc2_registrations set payment_status='paid'");
await assert.rejects(call(), /buyer/);
await db.exec('update mc2_registrations set payment_status=null');
const first = (await call()).rows[0].result;
assert.equal(first.session_generation,1);
assert.equal(first.utm_source,'meta');
assert.equal(first.attended_live,false);
await assert.rejects(call(), /session_changed/);
assert.equal((await db.query('select count(*)::int n from mc2_registration_history')).rows[0].n,1);
assert.equal((await db.query('select status from mc2_sms_jobs')).rows[0].status,'skipped');
assert.equal((await db.query('select status from mc2_session_email_jobs')).rows[0].status,'skipped');
assert.equal((await db.query("select has_function_privilege('anon','mc2_reregister_session(text,integer,jsonb)','execute') permitted")).rows[0].permitted,false);
console.log('SQL local OK : réexécution, rollback, achat, CTA, job en cours, tentative répétée, archivage, conservation acquisition, droits privés.');
await db.close();
