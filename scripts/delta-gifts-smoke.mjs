import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {signGiftToken,verifyGiftToken,parseGiftPurchase,giftReady,giftEmailContent} from '../netlify/functions/lib/delta-gifts.mjs';
import api from '../netlify/functions/delta-gifts.js';
import {runGiftJobs,fulfillGift} from '../netlify/functions/lib/delta-gifts-worker.mjs';
import {giftReceivedState} from '../src/lib/delta-gift-received.mjs';
import {syncGiftRecipient} from '../netlify/functions/lib/delta-gifts-mailerlite.mjs';
import {recipientPairs,validateRecipientPairs} from '../src/lib/delta-gift-recipients.mjs';
const env={DELTA_GIFTS_ENABLED:'true',DELTA_GIFTS_EMAILS_APPROVED:'true',DELTA_GIFTS_CIRCLE_APPROVED:'true',SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'mock',DELTA_GIFTS_SIGNING_KEY:'s'.repeat(64),DELTA_GIFTS_WEBHOOK_TOKEN:'w'.repeat(64),DELTA_GIFTS_CHECKOUT_ID:'123',DELTA_GIFTS_AMOUNT_UNIT:'major',MAILERSEND_API_KEY:'mock',DELTA_GIFTS_EMAIL_FROM:'sender@example.com',CIRCLE_ADMIN_API_TOKEN:'mock',DELTA_GIFTS_CIRCLE_GROUP_ID:'42',DELTA_GIFTS_CIRCLE_SPACE_IDS:'101,102',CIRCLE_COMMUNITY_HOST:'volt.sonnycourt.com',DELTA_GIFTS_ACCESS_URL:'https://volt.sonnycourt.com/c/delta-vision'};
const id='00000000-0000-4000-8000-000000000001',now=Date.now();
assert(giftReady(env));assert(!giftReady({...env,DELTA_GIFTS_EMAILS_APPROVED:'false'}));assert(!giftReady({...env,DELTA_GIFTS_ACCESS_URL:'https://evil.test'}));assert(!giftReady({...env,DELTA_GIFTS_AMOUNT_UNIT:''}));
const token=signGiftToken('owner',id,{env,now});
assert.equal(verifyGiftToken(token,'owner',{env,now}),id);assert.equal(verifyGiftToken(token,'gift',{env,now}),null);assert.equal(verifyGiftToken(token+'x','owner',{env,now}),null);assert.equal(verifyGiftToken(token,'owner',{env,now:now+31*86400000}),null);
for(const [price,count] of [[27,1],[51,3],[47,1],[81,3],[85,5]])assert.equal(parseGiftPurchase({checkout_id:123,order_id:789,email:'Me@Example.com',currency:'EUR',order_total:price},env).p_pack,count);
// Native Spiffy Custom Webhooks use numeric minor-unit totals and numeric zero for absent plans.
for(const [price,count] of [[2700,1],[5100,3],[4700,1],[8100,3],[8500,5]])assert.equal(parseGiftPurchase({checkout_id:123,order_id:789,email:'Me@Example.com',currency:'eur',order_total:price,subscription_id:0,payment_plan_id:0,has_order_bump:false},{...env,DELTA_GIFTS_AMOUNT_UNIT:'minor'}).p_pack,count);
for(const price of [17,50,52,51.01,'2.7e1','27.001'])assert.equal(parseGiftPurchase({checkout_id:123,order_id:789,email:'me@example.com',currency:'EUR',order_total:price},env),null);
for(const data of [{order_total:0},{order_total:4700},{currency:'USD'},{checkout_id:456},{payment_plan_id:2},{has_order_bump:true}])assert.equal(parseGiftPurchase({checkout_id:123,order_id:789,email:'me@example.com',currency:'EUR',order_total:47,...data},env),null);
const content=giftEmailContent('owner_email',{id,buyer_name:'<script>',pack_count:3},null,{env});assert(!content.html.includes('<script>'));assert(content.html.includes('&lt;script&gt;'));assert(content.text.includes('#owner='));
let externalCalls=0;assert.deepEqual(await runGiftJobs({env:{},fetcher:async()=>{externalCalls++;}}),{enabled:false,processed:0});assert.equal(externalCalls,0);
const req=body=>new Request('https://sonnycourt.com/.netlify/functions/delta-gifts',{method:'POST',headers:{Origin:'https://sonnycourt.com','Content-Type':'application/json'},body:JSON.stringify(body)});
assert.equal((await api(req({action:'owner',token:'forged'}),null,{env})).status,401);
assert.equal((await api(req({action:'owner',token}),null,{env:{}})).status,503);
assert.equal((await api(new Request('https://sonnycourt.com/.netlify/functions/delta-gifts',{method:'POST'}),null,{env})).status,403);
let circleWrites=0;
await assert.rejects(fulfillGift({recipient_email:'friend@example.com'},{env,fetcher:async(url,opts)=>{if(opts.method==='POST')circleWrites++;return Response.json({space_group_id:999});}}),/group_mismatch/);assert.equal(circleWrites,0);
const gift={id,order_id:id,recipient_email:'friend@example.com',recipient_name:'Friend',state:'assigned'};
const order={id,buyer_email:'buyer@example.com',buyer_name:'Buyer',pack_count:3,status:'paid'};
assert.deepEqual(await syncGiftRecipient(gift,{env}),{enabled:false});
await syncGiftRecipient(gift,{env:{...env,MAILERLITE_API_KEY:'mock',MAILERLITE_GROUP_DELTA_VISION_GIFTS:'777'},fetcher:async(url,opts)=>{
 const body=JSON.parse(opts.body);assert.deepEqual(body.groups,['777']);assert(!('status' in body));assert.equal(body.email,gift.recipient_email);return Response.json({data:{id:'123'}});
}});
const fetchDb=async url=>Response.json(String(url).includes('dv_gift_orders')?[order]:[gift]);
// Names survive the API boundary; legacy open pages without a name still work.
for(const recipient of [{slot:1,email:' FRIEND@EXAMPLE.COM ',firstName:' Léa '},{slot:1,email:'friend@example.com'}]){
 let assigned=0;
 const reply=await api(req({action:'assign',token,recipients:[recipient]}),null,{env,fetcher:async(url,opts)=>{
  if(String(url).endsWith('/rpc/dv_gift_assign')){assigned++;const r=JSON.parse(opts.body).p_recipients[0];assert.equal(r.email,'friend@example.com');if('firstName' in recipient)assert.equal(r.firstName,'Léa');else assert(!('firstName' in r));return Response.json(1);}
  return fetchDb(url);
 }});assert.equal(reply.status,200);assert.equal(assigned,1);
}
for(const firstName of ['',null,4,'   ','<script>','a\nb','x'.repeat(101)]){
 let writes=0;
 const reply=await api(req({action:'assign',token,recipients:[{slot:1,email:'friend@example.com',firstName}]}),null,{env,fetcher:async(url,opts)=>{if(opts?.method==='POST')writes++;return fetchDb(url);}});
 assert.equal(reply.status,400);assert.equal(writes,0);
}
assert.deepEqual(recipientPairs([['recipient-1-firstName',' Léa '],['recipient-1-email',' lea@example.com '],['recipient-2-firstName',''],['recipient-2-email','']]),[{slot:1,firstName:'Léa',email:'lea@example.com'}]);
for(const [nameValue,emailValue,expected] of [['','','blank'],[' Léa ','lea@example.com','complete'],['Léa','','partial'],['','lea@example.com','partial'],['  ','lea@example.com','partial']]){
 const field=value=>({value,required:false,error:'',setCustomValidity(s){this.error=s;}});
 const name=field(nameValue),email=field(emailValue);
 const form={querySelectorAll:()=>[{querySelector:selector=>selector.includes('name')?name:email}],reportValidity:()=>!name.error&&(!name.required||!!name.value.trim())&&(!email.required||!!email.value.trim())};
 assert.equal(validateRecipientPairs(form),expected!=='partial');assert.equal(name.required,expected!=='blank');assert.equal(email.required,expected!=='blank');
}
// Match the real Circle v2 shape, and never grant a whole group or product tag.
for(const existing of [true,false]){
  const writes=[];let added=existing;
  const mockCircle=async(url,opts)=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/spaces/101') || u.pathname.endsWith('/spaces/102'))return Response.json({space_group:{id:42},space_type:'course',is_private:true,is_hidden_from_non_members:true,is_draft:false});
    if(u.pathname.endsWith('/community_members/search'))return existing?Response.json({id:7,email:gift.recipient_email}):Response.json({}, {status:404});
    if(opts.method==='POST'){
      const body=JSON.parse(opts.body);writes.push({path:u.pathname,body});
      if(u.pathname.endsWith('/community_members'))return Response.json({id:7,email:gift.recipient_email});
      if(u.pathname.endsWith('/space_members')){added=true;return Response.json({message:'User added to space'});}
      throw new Error('unexpected_circle_write');
    }
    if(u.pathname.endsWith('/space_member'))return added?Response.json({space_id:Number(u.searchParams.get('space_id')),community_member_id:7,status:'active'}):Response.json({}, {status:404});
    throw new Error('unexpected_circle_read');
  };
  assert.equal(await fulfillGift(gift,{env,fetcher:mockCircle}),'7');
  assert(writes.every(w=>!w.path.includes('space_group_members')));
  const invite=writes.find(w=>w.path.endsWith('/community_members'));
  if(invite){assert.deepEqual(invite.body.space_group_ids,[]);assert.deepEqual(invite.body.member_tag_ids,[]);assert.deepEqual(invite.body.space_ids,[101,102]);}
}
const giftToken=signGiftToken('gift',id,{env});
const recipientContent=giftEmailContent('gift_email',order,gift,{env});
assert(recipientContent.text.includes('/delta-vision-cadeau-recu/#gift='));
assert(recipientContent.text.includes('12 minutes'));assert(!recipientContent.text.includes('15 minutes'));
assert(recipientContent.text.includes('Activer mon cadeau'));
assert.equal(giftReceivedState({state:'activating'}).mode,'pending');
assert.equal(giftReceivedState({state:'assistance'}).mode,'assistance');
assert.equal(giftReceivedState({state:'active',url:env.DELTA_GIFTS_ACCESS_URL}).mode,'active');
for(const url of ['https://evil.test/c/delta-vision','https://volt.sonnycourt.com/c/es2','javascript:alert(1)','https://volt.sonnycourt.com/c/delta-vision?redirect=evil'])assert.throws(()=>giftReceivedState({state:'active',url}));
const receivedPage=readFileSync(new URL('../src/pages/delta-vision-cadeau-recu.astro',import.meta.url),'utf8');
assert(receivedPage.includes('data-gift-activation'));assert(!receivedPage.includes('spiffy.co'));
const salesPage=readFileSync(new URL('../src/pages/delta-vision.astro',import.meta.url),'utf8');
assert(salesPage.includes("location.replace('/delta-vision-cadeau-recu/' + location.hash)"));
let activationCalls=0;
const mockActivate=async(url,opts)=>{
 if(String(url).endsWith('/rpc/dv_gift_activate')){activationCalls++;assert.equal(JSON.parse(opts.body).p_gift,id);return Response.json('activating');}
 return fetchDb(url);
};
const activationResponse=await api(req({action:'recognize',token:giftToken,email:gift.recipient_email,firstName:'Friend'}),null,{env,fetcher:mockActivate});
assert.equal(activationResponse.status,200);assert.equal((await activationResponse.json()).state,'activating');assert.equal(activationCalls,1);
const activeDb=async url=>Response.json(String(url).includes('dv_gift_orders')?[order]:[{...gift,state:'active'}]);
const statusResponse=await api(req({action:'status',token:giftToken,email:gift.recipient_email}),null,{env,fetcher:activeDb});
assert.equal((await statusResponse.json()).url,env.DELTA_GIFTS_ACCESS_URL);
assert.equal((await api(req({action:'status',email:gift.recipient_email}),null,{env,fetcher:activeDb})).status,401);
assert.equal((await api(req({action:'recognize',token:giftToken,email:'someoneelse@example.com',firstName:'Other'}),null,{env,fetcher:fetchDb})).status,403);
// Real local Postgres engine: SQL constraints, transactions, idempotency and role protections.
const pg=new PGlite();await pg.exec('create role anon; create role authenticated; create role service_role;');
const sql=readFileSync(new URL('../sql/delta_vision_gifts.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
const scalar=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const orderId=await scalar("select dv_gift_record_order('123','buyer@example.com','Buyer',3,8100)");
assert.equal(await scalar("select dv_gift_record_order('123','buyer@example.com','Buyer',3,8100)"),orderId);
assert.equal(Number(await scalar('select count(*) from dv_gifts')),3);
await assert.rejects(pg.query("select dv_gift_record_order('123','buyer@example.com','Buyer',5,8500)"),/order_conflict/);
await assert.rejects(pg.query("select dv_gift_record_order('124','buyer@example.com','Buyer',5,8100)"));
await pg.query('select dv_gift_assign($1,$2)',[orderId,JSON.stringify([{slot:1,email:'Friend@Example.com'}])]);
assert.equal(await scalar('select dv_gift_assign($1,$2)',[orderId,JSON.stringify([{slot:1,email:'friend@example.com'}])]),0);
await assert.rejects(pg.query('select dv_gift_assign($1,$2)',[orderId,JSON.stringify([{slot:4,email:'extra@example.com'}])]));
await assert.rejects(pg.query('select dv_gift_assign($1,$2)',[orderId,JSON.stringify([{slot:2,email:'two@example.com'},{slot:3,email:'friend@example.com'}])]));
assert.equal(await scalar('select state from dv_gifts where order_id=$1 and slot=2',[orderId]),'available','Failed assignment batch must roll back ALL slots');
const giftId=await scalar('select id from dv_gifts where order_id=$1 and slot=1',[orderId]);
await assert.rejects(pg.query('select dv_gift_activate($1,$2,$3)',[giftId,'wrong@example.com','Wrong']),/gift_invalid/);
assert.equal(await scalar('select dv_gift_activate($1,$2,$3)',[giftId,'friend@example.com','Friend']),'activating');
await pg.query('select dv_gift_activate($1,$2,$3)',[giftId,'friend@example.com','Friend']);
assert.equal(Number(await scalar("select count(*) from dv_gift_jobs where kind='activate'")),1);
const claimed=(await pg.query("select * from dv_gift_claim_jobs(array['activate'],5)")).rows;assert.equal(claimed.length,1);
assert.equal((await pg.query("select * from dv_gift_claim_jobs(array['activate'],5)")).rows.length,0);
assert.equal(await scalar("select has_table_privilege('anon','dv_gifts','SELECT')"),false);
assert.equal(await scalar("select has_function_privilege('authenticated','dv_gift_assign(uuid,jsonb)','EXECUTE')"),false);
// Price migration preserves existing orders and is safe to re-run.
const pricesSql=readFileSync(new URL('../sql/delta_vision_gifts_prices_27_51.sql',import.meta.url),'utf8');
await pg.exec(pricesSql);await pg.exec(pricesSql);
assert.equal(await scalar("select dv_gift_record_order('123','buyer@example.com','Buyer',3,8100)"),orderId);
const oneNew=await scalar("select dv_gift_record_order('127','one@example.com','One',1,2700)");
const threeNew=await scalar("select dv_gift_record_order('151','three@example.com','Three',3,5100)");
assert.equal(Number(await scalar('select count(*) from dv_gifts where order_id=$1',[oneNew])),1);
assert.equal(Number(await scalar('select count(*) from dv_gifts where order_id=$1',[threeNew])),3);
assert.equal(await scalar("select dv_gift_record_order('151','three@example.com','Three',3,5100)"),threeNew);
for(const [pack,amount] of [[3,1700],[3,2700],[1,5100],[5,5100]])await assert.rejects(pg.query('select dv_gift_record_order($1,$2,$3,$4,$5)',['999','bad@example.com','Bad',pack,amount]));
// Name migration is atomic, backwards compatible and re-runnable.
const namesSql=readFileSync(new URL('../sql/delta_vision_gifts_recipient_name.sql',import.meta.url),'utf8');
await pg.exec(namesSql);await pg.exec(namesSql);
const assignNames=recipients=>pg.query('select dv_gift_assign($1,$2)',[threeNew,JSON.stringify(recipients)]);
await assignNames([{slot:1,email:'LEA@example.com',firstName:' Léa '}]);
assert.equal(await scalar('select recipient_name from dv_gifts where order_id=$1 and slot=1',[threeNew]),'Léa');
await assignNames([{slot:1,email:'lea@example.com',firstName:'Changed'}]);
assert.equal(await scalar('select recipient_name from dv_gifts where order_id=$1 and slot=1',[threeNew]),'Léa','Replay must not overwrite a saved identity');
assert.equal(Number(await scalar("select count(*) from dv_gift_jobs where order_id=$1 and kind='gift_email'",[threeNew])),1);
for(const firstName of ['',null,9,'  ','<script>','a\nb','x'.repeat(101)])await assert.rejects(assignNames([{slot:2,email:'bad-name@example.com',firstName}]),/invalid_name/);
await assert.rejects(assignNames([{slot:2,email:'rollback@example.com',firstName:'Rollback'},{slot:3,email:'lea@example.com',firstName:'Duplicate'}]));
assert.equal(await scalar('select recipient_name from dv_gifts where order_id=$1 and slot=2',[threeNew]),null,'Name must roll back with failed assignment');
await assignNames([{slot:2,email:'legacy@example.com'}]);
assert.equal(await scalar('select recipient_name from dv_gifts where order_id=$1 and slot=2',[threeNew]),null);
const namedGift=await scalar('select id from dv_gifts where order_id=$1 and slot=1',[threeNew]);
await pg.query('select dv_gift_activate($1,$2,$3)',[namedGift,'lea@example.com','Léa-Marie']);
assert.equal(await scalar('select recipient_name from dv_gifts where id=$1',[namedGift]),'Léa-Marie','Recipient confirms their own name on activation');
assert.equal(await scalar("select has_function_privilege('anon','dv_gift_assign(uuid,jsonb)','EXECUTE')"),false);
await pg.close();
console.log('PASS Delta gifts: signed links, purpose/expiry, strict pricing, disabled sends, identity isolation, Circle scope, SQL replay/limits/rollback/leases/RLS. No external writes or emails.');
