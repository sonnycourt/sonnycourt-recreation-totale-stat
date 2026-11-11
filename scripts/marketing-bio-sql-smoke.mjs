// Disposable local database only. Never connect this fixture to Supabase.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table marketing_links(id uuid primary key,code text unique,channel text);
    grant usage on schema public to service_role;grant select on marketing_links to service_role;
    insert into marketing_links values('${randomUUID()}','e7dd5eb52276','tiktok'),('${randomUUID()}','d70aca695f3c','youtube');`);
  const migration=readFileSync(new URL('../sql/marketing_bio_choices_v1.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);await db.exec('set role service_role;');
  const put=async(id,code=null,source='direct',choice=null)=>(await db.query('select marketing_record_bio_visit($1,$2,$3,$4) as ok',[id,code,source,choice])).rows[0].ok;
  const report=async(days=0)=>(await db.query('select marketing_bio_report($1) as data',[days])).rows[0].data;
  const a=randomUUID(),b=randomUUID(),c=randomUUID(),d=randomUUID();
  assert.ok(await put(a,'e7dd5eb52276','youtube')); // Registry source wins over caller hint.
  assert.ok(await put(a,'e7dd5eb52276','youtube','delta'));
  assert.ok(await put(a,'e7dd5eb52276','youtube','mc2')); // Second choice never replaces first.
  assert.ok(await put(a,'e7dd5eb52276')); // Late visit retry does not erase choice.
  assert.ok(await put(b,'d70aca695f3c','direct','mc2')); // A fast click creates both visit and choice.
  assert.ok(await put(c));assert.ok(await put(d,null,'facebook','delta'));
  assert.equal(await put(a,'d70aca695f3c','youtube','mc2'),false,'Cannot reassign a visit to another source');
  assert.equal(await put(randomUUID(),'ffffffffffff'),false,'Unknown code does not silently lose attribution');
  const r=await report();assert.deepEqual(r.totals,{visits:4,choices:3,mc2:1,delta:2,no_choice:1});
  assert.equal(r.bio_links.find(x=>x.channel==='tiktok').delta,1);assert.equal(r.sources.find(x=>x.source==='tiktok').visits,1);
  assert.equal(r.bio_links.find(x=>x.channel==='youtube').mc2,1);
  await assert.rejects(put(randomUUID(),null,'anything'));await assert.rejects(put(randomUUID(),null,'direct','invalid'));await assert.rejects(report(90));
  await db.exec(`reset role;update marketing_bio_visits set seen_at=now()-interval '10 days' where id='${c}';set role service_role;`);
  assert.equal((await report(7)).totals.visits,3);assert.equal((await report(30)).totals.visits,4);
  await db.exec('reset role;set role anon;');await assert.rejects(report());await assert.rejects(put(randomUUID()));
  await db.exec('reset role;set role authenticated;');await assert.rejects(report());
  console.log('PASS — SQL réexécutable, déduplication, premier choix, clic rapide, source immuable, pourcentages calculables, périodes et droits privés.');
} finally {await db.close();}
