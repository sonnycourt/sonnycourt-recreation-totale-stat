import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import api from '../netlify/functions/delta-gifts.js';
import purchase from '../netlify/functions/delta-gifts-purchase.js';
import {runGiftJobs} from '../netlify/functions/lib/delta-gifts-worker.mjs';
const env={DELTA_GIFTS_ENABLED:'true',DELTA_GIFTS_EMAILS_APPROVED:'true',DELTA_GIFTS_CIRCLE_APPROVED:'true',SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'mock',DELTA_GIFTS_SIGNING_KEY:'s'.repeat(64),DELTA_GIFTS_WEBHOOK_TOKEN:'w'.repeat(64),DELTA_GIFTS_CHECKOUT_ID:'41041',DELTA_GIFTS_AMOUNT_UNIT:'minor',MAILERSEND_API_KEY:'mock',DELTA_GIFTS_EMAIL_FROM:'sender@example.com',CIRCLE_ADMIN_API_TOKEN:'mock',DELTA_GIFTS_CIRCLE_GROUP_ID:'42',DELTA_GIFTS_CIRCLE_SPACE_IDS:'101',CIRCLE_COMMUNITY_HOST:'volt.sonnycourt.com',DELTA_GIFTS_ACCESS_URL:'https://volt.sonnycourt.com/c/delta-vision'};
Object.assign(env,{MAILERLITE_API_KEY:'mock',DELTA_GIFTS_MAILERLITE_EMAILS_ENABLED:'true',DELTA_GIFTS_ML_OWNER_GROUP:'12345',DELTA_GIFTS_ML_OWNER_AUTOMATION:'67890'});
const id='00000000-0000-4000-8000-000000000001',id2='00000000-0000-4000-8000-000000000002';
const request=body=>new Request('https://sonnycourt.com/.netlify/functions/delta-gifts',{method:'POST',headers:{Origin:'https://sonnycourt.com','Content-Type':'application/json'},body:JSON.stringify(body)});
for(const [allowed,orders] of [[true,[{id},{id:id2}]],[true,[]],[false,[{id}]]]){
  const queued=[];let reads=0;
  const response=await api(request({action:'recover',email:' BUYER@example.com '}),null,{env,fetcher:async(url,opts)=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/rpc/dv_gift_throttle')){assert.equal(JSON.parse(opts.body).p_seconds,86400);return Response.json(allowed);}
    if(u.pathname.endsWith('/dv_gift_orders')){
      reads++;assert.equal(u.searchParams.get('buyer_email'),'eq.buyer@example.com');assert.equal(u.searchParams.get('status'),'eq.paid');assert(!u.searchParams.has('spiffy_order_id'));return Response.json(orders);
    }
    if(u.pathname.endsWith('/dv_gift_jobs')){queued.push(JSON.parse(opts.body));assert.equal(opts.headers.Prefer,'resolution=ignore-duplicates,return=representation');return Response.json([]);}
    throw new Error('unexpected_request');
  }});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,state:'check_email'});
  assert.equal(reads,allowed?1:0);assert.deepEqual(queued.map(j=>j.order_id),allowed?orders.slice(0,1).map(o=>o.id):[]);
  assert(queued.every(j=>j.kind==='owner_email' && !j.gift_id));
}
let unexpected=0;
assert.equal((await api(request({action:'recover',email:'invalid'}),null,{env,fetcher:async()=>{unexpected++;}})).status,400);
assert.equal(unexpected,0);
const page=readFileSync('src/pages/delta-vision-cadeaux.astro','utf8');
assert(!page.includes('id="gift-order"'));assert(!page.includes('name="order"'));assert(page.includes('gift-owner-email'));

// Complete mocked chain: authenticated Spiffy event -> credits -> queued email -> provider acceptance.
// No network calls, real database writes or emails.
for(const [amount,pack] of [[4700,1],[8100,3]])for(const formEncoded of [false,true]){
  const calls=[],order={id,buyer_email:'buyer@example.com',buyer_name:'Buyer',status:'paid',pack_count:pack};
  const payload={checkout_id:41041,order_id:789,email:order.buyer_email,name_first:order.buyer_name,currency:'eur',order_total:amount,subscription_id:0,payment_plan_id:0,has_order_bump:false};
  const response=await purchase(new Request(`https://sonnycourt.com/.netlify/functions/delta-gifts-purchase?token=${env.DELTA_GIFTS_WEBHOOK_TOKEN}`,{method:'POST',headers:{'Content-Type':formEncoded?'application/x-www-form-urlencoded':'application/json'},body:formEncoded?new URLSearchParams(payload).toString():JSON.stringify(payload)}),null,{env,fetcher:async(url,opts)=>{
    assert(String(url).endsWith('/rpc/dv_gift_record_order'));const p=JSON.parse(opts.body);assert.equal(p.p_pack,pack);assert.equal(p.p_amount,amount);calls.push('record');return Response.json(id);
  }});
  assert.equal(response.status,200);
  const result=await runGiftJobs({env,fetcher:async(url,opts)=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/rpc/dv_gift_claim_jobs'))return Response.json([{id:id2,order_id:id,kind:'owner_email',job_key:`owner:${id}`,lock_token:id2,attempts:1}]);
    if(u.pathname.endsWith('/dv_gift_orders'))return Response.json([order]);
    if(u.pathname.endsWith('/automations/67890'))return Response.json({data:{enabled:true,complete:true,trigger_data:{repeatable:true},triggers:[{type:'subscriber_joins_group',group_ids:['12345']}],steps:[{type:'email',complete:true}]}});
    if(u.pathname.endsWith('/subscribers/buyer%40example.com'))return Response.json({}, {status:404});
    if(u.pathname.endsWith('/subscribers')){const body=JSON.parse(opts.body);assert.equal(body.email,order.buyer_email);assert(body.fields.dv_gift_owner_url.includes('#owner='));assert(!('status' in body));return Response.json({data:{id:'999',status:'active',groups:[]}});}
    if(u.pathname.endsWith('/subscribers/999/groups/12345')){calls.push('email');return new Response(null,{status:204});}
    if(u.pathname.endsWith('/dv_gift_jobs') && opts.method==='GET')return Response.json([]);
    if(u.pathname.endsWith('/dv_gift_jobs')){assert.equal(JSON.parse(opts.body).state,'done');assert.equal(u.searchParams.get('lock_token'),`eq.${id2}`);calls.push('done');return Response.json([]);}
    throw new Error(`unexpected_mock_request:${u.pathname}`);
  }});
  assert.deepEqual(calls,['record','email','done']);assert.equal(result.processed,1);
}
// Unsupported prices remain rejected, with no identity or secret in diagnostics.
const diagnostics=[];
const bad=await purchase(new Request(`https://sonnycourt.com/.netlify/functions/delta-gifts-purchase?token=${env.DELTA_GIFTS_WEBHOOK_TOKEN}`,{method:'POST',body:JSON.stringify({checkout_id:41041,order_id:789,email:'buyer@example.com',currency:'eur',order_total:300})}),null,{env,logger:{warn:(...args)=>diagnostics.push(args)},fetcher:async()=>{throw new Error('must_not_write');}});
assert.equal(bad.status,422);assert.equal(diagnostics.length,1);assert(!JSON.stringify(diagnostics).includes('@'));assert(!JSON.stringify(diagnostics).includes(env.DELTA_GIFTS_WEBHOOK_TOKEN));
console.log('PASS: email-only recovery, all buyer orders, privacy, throttling, JSON/form webhook, 47/81 EUR fulfillment and approved email pipeline (all mocked).');
