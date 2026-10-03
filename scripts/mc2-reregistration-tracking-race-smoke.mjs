import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const sql = name => readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
await db.exec(`create role anon; create role authenticated; create role service_role;
create table mc2_registrations(token text primary key,traffic_source text,session_generation integer not null default 0);
insert into mc2_registrations values('fixture-race','meta_ad',0);`);
await db.exec(sql('mc2_tracking_v2.sql'));
await db.exec(sql('mc2_tracking_v2_meta_delivery.sql'));
const event = {event_id:'ac8d6388-b119-4a3f-ab2f-f1d5b5beb900',token:'fixture-race',
 event_name:'cta_playback_present',client_occurred_at:new Date().toISOString(),
 visit_id:'bc8d6388-b119-4a3f-ab2f-f1d5b5beb901',route:'/mc2/session/',
 webinar_version:'fixture',offer_version:'fixture',metadata:{session_generation:0}};
const ingest = e => db.query('select mc2_tracking_ingest_v2($1::jsonb)',[JSON.stringify([e])]);
// L'API avait lu 0, puis une réinscription se termine avant son insertion.
await db.exec('update mc2_registrations set session_generation=1');
await ingest(event);
assert.equal((await db.query('select count(*)::int n from mc2_tracking_events_v2')).rows[0].n,1,
 'Reproduction : sans garde transactionnelle, le CTA de l’ancien onglet entre');
await db.exec('delete from mc2_tracking_meta_outbox; delete from mc2_tracking_events_v2');
await db.exec(sql('mc2_reregistration_tracking_guard.sql'));
await db.exec(sql('mc2_reregistration_tracking_guard.sql'));
await assert.rejects(ingest(event),/session_changed/);
await assert.rejects(ingest({...event,metadata:{}}),/session_changed/);
assert.equal((await db.query('select count(*)::int n from mc2_tracking_meta_outbox')).rows[0].n,0);
await ingest({...event,metadata:{session_generation:1}});
await ingest({...event,metadata:{session_generation:1}});
assert.equal((await db.query('select count(*)::int n from mc2_tracking_events_v2')).rows[0].n,1);
await db.exec("insert into mc2_registrations values('fixture-old-client',null,0)");
await ingest({...event,event_id:'cc8d6388-b119-4a3f-ab2f-f1d5b5beb902',token:'fixture-old-client',metadata:{}});
assert.equal((await db.query('select count(*)::int n from mc2_tracking_events_v2')).rows[0].n,2);
await db.close();
console.log('PASS : course reproduite sans garde, refus atomique avec garde, Meta non écrit, client génération 0 compatible, réexécution et déduplication OK.');
