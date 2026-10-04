import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {presentCase} from '../netlify/functions/lib/onboarding-domain.mjs';
import {renderPayments} from '../src/scripts/onboarding-payments.js';
const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table closer_access_codes(id bigint,label text,active boolean,password_hash text);
insert into closer_access_codes values(22,'Romain',true,'local');
create table onboarding_staff(closer_id bigint,active boolean,default_assignee boolean);
insert into onboarding_staff values(22,true,true);
create table mc2_tracking_test_registrations(token text);
create table mc2_registrations(id bigint,token text,email text,prenom text,billing_full_name text,billing_phone text,telephone text,billing_country text,pays text,billing_city text,purchased_at timestamptz,statut text,initial_payment_cents integer,checkout_last_payment_mode text,payment_status text,paid_installment_count integer);
create table onboarding_cases(email text primary key,registration_id bigint,source text,assigned_closer_id bigint,display_name text,phone text,country text,city text,purchased_at timestamptz,plan text constraint onboarding_cases_plan_check check(plan in ('twelve','six','legacy_three')),payment_status text,paid_installment_count integer,notes text default '',status text default 'new');
insert into mc2_registrations(id,token,email,prenom,purchased_at,statut,initial_payment_cents,checkout_last_payment_mode,payment_status) values
(1,'one','one@invalid.local','Alice','2026-10-03','purchased',199700,'spiffy_one_time_1997','paid'),
(2,'monthly','monthly@invalid.local','Bob','2026-10-04','purchased',76700,'spiffy_3x767','paid'),
(3,'old','old@invalid.local','Claire','2026-09-15','purchased',0,'spiffy_j7_12x197','paid'),
(4,'bad','test@invalid.local','Test','2026-10-03','purchased',19700,'spiffy_12x197','paid'),
(5,'pending','pending@invalid.local','Pending','2026-10-03','registered',19700,'spiffy_12x197','pending'),
(6,'marked','marked@invalid.local','Marked','2026-10-03','purchased',19700,'spiffy_12x197','paid');
insert into mc2_tracking_test_registrations values('marked');
`);
const before=JSON.stringify((await db.query('select * from mc2_registrations')).rows);
const sql=await readFile(new URL('../sql/onboarding_paid_buyers.sql',import.meta.url),'utf8');
await db.exec(sql); await db.exec(sql);
let rows=(await db.query('select * from onboarding_cases order by registration_id')).rows;
assert.deepEqual(rows.map(r=>r.plan),['paid_once','paid_monthly','twelve']);
assert.ok(rows.every(r=>r.assigned_closer_id===22));
await db.exec("update onboarding_cases set notes='Conserver',status='done',assigned_closer_id=99 where registration_id=1");
await db.exec("insert into mc2_registrations(id,token,email,prenom,purchased_at,statut,initial_payment_cents,checkout_last_payment_mode,payment_status) values(7,'future','future@invalid.local','Future','2026-10-05','purchased',19700,'spiffy_12x197','paid'); select onboarding_sync_cases();");
rows=(await db.query('select * from onboarding_cases order by registration_id')).rows;
assert.equal(rows.length,4);
assert.equal(rows[0].notes,'Conserver'); assert.equal(rows[0].status,'done'); assert.equal(rows[0].assigned_closer_id,99);
assert.equal(JSON.stringify((await db.query('select * from mc2_registrations where id<7')).rows),before);
assert.equal(presentCase(rows[0]).first_payment_date,null);
assert.match(presentCase(rows[0]).plan_label,/une fois/);
assert.match(presentCase(rows[1]).plan_label,/échelonné/);
assert.equal(presentCase(rows[2]).first_payment_date,'2026-09-22');
const html=renderPayments({rows:[{...rows[0],available:false}],summary:{cohort:0,first_paid:0,first_failed:0,upcoming_count:0,upcoming_minor:0}});
assert.match(html,/Paiement en une fois/); assert.doesNotMatch(html,/12 × 197/);
await db.close();
console.log('PASS: idempotent backfill, future buyers, tests excluded, Romain assignment, notes preserved, no source writes, correct modality, no false J+7.');
