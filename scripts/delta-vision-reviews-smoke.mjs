import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {transform} from '@astrojs/compiler';
import submit, {config} from '../netlify/functions/delta-vision-review.js';
import admin from '../netlify/functions/admin-delta-vision-reviews.js';
import {validateDeltaReview} from '../netlify/functions/lib/delta-review-validation.mjs';
import {signSessionToken} from '../netlify/functions/lib/admin-es2-crypto.mjs';
import {getAdminEs2CookieSecret} from '../netlify/functions/lib/admin-es2-session-secret.mjs';

// All storage and network calls are isolated. Never contacts production.
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../sql/delta_vision_reviews.sql',import.meta.url),'utf8');
await db.exec(sql);
const second = await db.exec(sql);
assert.equal(second.at(-1).rows[0].delta_reviews_ready,true,'migration is safe to rerun');
for (const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await assert.rejects(db.query('select * from public.delta_vision_reviews'),/permission denied/);
  await db.exec('reset role');
}
const good = {requestId:randomUUID(),firstName:' Test ',email:'TEST@example.com',rating:5,review:'Une expérience agréable.',improvements:''};
assert.equal(validateDeltaReview(good).email,'test@example.com');
assert.equal(validateDeltaReview({...good,visibility:'public',identity_verified:true}).visibility,'private');
assert.equal(validateDeltaReview({...good,identity_verified:true}).identity_verified,false);
for (const patch of [{rating:0},{rating:6},{rating:'5'},{email:'bad'},{firstName:' '},{review:' '},{website:'bot'},
  {firstName:'x'.repeat(81)},{requestId:'bad'},{improvements:[]},{review:'x'.repeat(10001)}]) {
  assert.equal(validateDeltaReview({...good,...patch}),null,JSON.stringify(patch).slice(0,100));
}
for (const rating of [1,2,3,4,5]) assert.ok(validateDeltaReview({...good,rating}));
process.env.SUPABASE_URL='https://delta-review-test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-test-key';
let requests=0, fail=false;
const oldFetch=globalThis.fetch;
globalThis.fetch=async (url,opts={})=>{
  assert.ok(url.startsWith('https://delta-review-test.invalid/rest/v1/'),'no external network allowed');
  requests++;
  if(fail)return new Response('{}',{status:503});
  if(opts.method==='POST'){
    const row=JSON.parse(opts.body);
    assert.match(opts.headers.Prefer,/ignore-duplicates/);
    await db.query('insert into public.delta_vision_reviews(id,first_name,email,rating,review,improvements,visibility,identity_verified) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do nothing',
      [row.id,row.first_name,row.email,row.rating,row.review,row.improvements,row.visibility,row.identity_verified]);
    return new Response(null,{status:201});
  }
  const params=new URL(url).searchParams;
  const result=await db.query('select * from public.delta_vision_reviews order by created_at desc,id desc limit 51 offset $1',[Number(params.get('offset'))]);
  return new Response(JSON.stringify(result.rows),{status:200});
};
const request=(body=good,options={})=>new Request('https://sonnycourt.com/.netlify/functions/delta-vision-review',{
  method:'POST',headers:{origin:'https://sonnycourt.com','content-type':'application/json',...options.headers},
  body:JSON.stringify(body),...options
});
try{
  assert.equal((await submit(request())).status,200);
  assert.equal((await submit(request())).status,200);
  assert.equal((await db.query('select count(*)::int as count from public.delta_vision_reviews')).rows[0].count,1);
  const before=requests;
  assert.equal((await submit(request(good,{headers:{origin:'https://attacker.invalid','content-type':'application/json'}}))).status,403);
  assert.equal((await submit(request({...good,rating:8}))).status,400);
  assert.equal((await submit(request({...good,website:'bot'}))).status,400);
  assert.equal((await submit(request({...good,review:'x'.repeat(90001)}))).status,413);
  assert.equal((await submit(new Request('https://sonnycourt.com/.netlify/functions/delta-vision-review'))).status,405);
  assert.equal(requests,before,'invalid requests never reach storage');
  fail=true;assert.equal((await submit(request())).status,503);fail=false;
  const adminURL='https://sonnycourt.com/.netlify/functions/admin-delta-vision-reviews';
  assert.equal((await admin(new Request(adminURL))).status,401);
  const cookie='admin_es2_session='+signSessionToken(getAdminEs2CookieSecret(),60000);
  const response=await admin(new Request(adminURL,{headers:{cookie}}));
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal((await response.json()).reviews[0].email,'test@example.com');
  assert.equal((await admin(new Request(adminURL,{headers:{cookie,origin:'https://attacker.invalid'}}))).status,403);
  assert.equal((await admin(new Request(adminURL+'?page=-1',{headers:{cookie}}))).status,400);
  for(let i=0;i<51;i++) await submit(request({...good,requestId:randomUUID(),rating:1}));
  const first=await (await admin(new Request(adminURL,{headers:{cookie}}))).json();
  assert.equal(first.reviews.length,50);assert.equal(first.hasMore,true);
  const last=await (await admin(new Request(adminURL+'?page=1',{headers:{cookie}}))).json();
  assert.equal(last.reviews.length,2);assert.equal(last.hasMore,false);
  await assert.rejects(db.query("update public.delta_vision_reviews set visibility='public'"),/check constraint/);
  for(const name of ['delta-vision/review','admin/delta-vision-reviews']){
    const source=await readFile(new URL('../src/pages/'+name+'.astro',import.meta.url),'utf8');
    await transform(source,{filename:name+'.astro'});
  }
  assert.equal(config.rateLimit.windowLimit,5);
  console.log('PASS: SQL rerun + private permissions, all ratings, input validation, retry deduplication, server failures, admin authentication, pagination, both Astro pages.');
}finally{globalThis.fetch=oldFetch;await db.close();}
