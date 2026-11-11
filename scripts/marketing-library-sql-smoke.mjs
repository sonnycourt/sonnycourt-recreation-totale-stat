// Disposable local PostgreSQL only: never connect to Supabase.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite();
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table public.mc2_registrations(id bigint primary key,token text unique,registration_completed_at timestamptz);
    grant usage on schema public to service_role;grant select on public.mc2_registrations to service_role;`);
  for(const name of ['marketing_links_v1','marketing_links_publication_v2','marketing_links_library_v3','marketing_links_library_v3'])await db.exec(readFileSync(new URL('../sql/'+name+'.sql',import.meta.url),'utf8'));
  // All timestamps are identical: cursor ordering must use the ID as well.
  await db.exec(`insert into marketing_contents(id,title,format,created_at)
      select md5(i::text)::uuid,'Contenu '||i,'short','2026-11-11T10:00:00.123456Z' from generate_series(1,2500) i;
    insert into marketing_publications(id,content_id,channel,label)
      select id,id,case when title='Contenu 2500' then 'email' else 'instagram' end,'Publication '||title from marketing_contents;
    insert into marketing_links(id,publication_id,code,channel,placement,campaign,destination,created_at)
      select id,id,left(replace(id::text,'-',''),12),channel,'bio','mc2-evergreen','mc2','2026-11-11T10:00:00.123456Z' from marketing_publications;
    set role service_role;`);
  const page=async(kind='links',q='',channel='',cursor=null,take=100)=>(await db.query('select marketing_library_page($1,$2,$3,$4,$5,$6) as v',[kind,q,channel,cursor?.at||null,cursor?.id||null,take])).rows[0].v;
  for(const kind of ['links','contents']){
    const ids=new Set();let cursor=null;
    do{const result=await page(kind,'','',cursor);assert.equal(result.total,2500);for(const row of result.items){assert.ok(!ids.has(row.id),'No duplicates across equal timestamps');ids.add(row.id);}cursor=result.next_cursor;}while(cursor);
    assert.equal(ids.size,2500,'No 200/500/1000-row ceiling');
  }
  const old=(await db.query('select title from marketing_contents order by created_at,id limit 1')).rows[0].title;
  assert.ok((await page('links',old)).items.some(x=>x.title===old),'Oldest link searchable');
  assert.ok((await page('contents',old)).items.some(x=>x.title===old),'Oldest content reusable');
  const email=await page('links','2500','email');assert.equal(email.total,1);assert.equal(email.items[0].channel,'email');
  assert.equal((await page('links','2500','sms')).total,0);
  assert.equal((await page('links','%')).total,0,'Search is literal, not a SQL wildcard');
  assert.equal((await page('summary')).totals.links,2500);
  // Several arrivals by one registrant must not multiply the registration count;
  // an arrival after registration must not be credited as acquisition.
  const fixtureLink=email.items[0];
  await db.exec(`reset role;
    insert into mc2_registrations values(1,'fixture-1','2026-11-11T12:00:00Z'),(2,'fixture-2','2026-11-11T12:00:00Z');
    insert into marketing_touchpoints(id,link_id,occurred_at)
      values(md5('touch1')::uuid,'${fixtureLink.id}','2026-11-11T11:00:00Z'),
      (md5('touch2')::uuid,'${fixtureLink.id}','2026-11-11T11:30:00Z'),
      (md5('touch3')::uuid,'${fixtureLink.id}','2026-11-11T13:00:00Z');
    insert into marketing_mc2_attribution(touchpoint_id,registration_id,method)
      values(md5('touch1')::uuid,1,'registration_receipt'),(md5('touch2')::uuid,1,'registration_receipt'),(md5('touch3')::uuid,2,'registration_receipt');
    set role service_role;`);
  const measured=(await page('links',fixtureLink.code)).items[0];
  assert.equal(measured.arrivals,3);assert.equal(measured.registrations,1);
  const totals=(await page('summary')).totals;assert.equal(totals.arrivals,3);assert.equal(totals.registrations,1);
  await assert.rejects(page('links','','',null,101));await assert.rejects(page('invalid'));
  await db.exec('reset role;set role anon;');await assert.rejects(page());
  await db.exec('reset role;set role authenticated;');await assert.rejects(page());
  console.log('PASS — 2 500 liens et contenus tous parcourus, timestamps identiques, recherche du plus ancien, filtres globaux, droits privés et SQL réexécutable.');
}finally{await db.close();}
