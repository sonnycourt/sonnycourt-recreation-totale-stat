import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import api from '../netlify/functions/delta-gifts.js';
import {verifyGiftBuyerToken} from '../netlify/functions/lib/delta-gifts.mjs';
const env={DELTA_GIFTS_ENABLED:'true',DELTA_GIFTS_EMAILS_APPROVED:'true',DELTA_GIFTS_CIRCLE_APPROVED:'true',SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'mock',DELTA_GIFTS_SIGNING_KEY:'s'.repeat(64),DELTA_GIFTS_WEBHOOK_TOKEN:'w'.repeat(64),DELTA_GIFTS_CHECKOUT_ID:'41041',DELTA_GIFTS_AMOUNT_UNIT:'minor',CIRCLE_ADMIN_API_TOKEN:'mock',DELTA_GIFTS_CIRCLE_GROUP_ID:'42',DELTA_GIFTS_CIRCLE_SPACE_IDS:'101',CIRCLE_COMMUNITY_HOST:'volt.sonnycourt.com',DELTA_GIFTS_ACCESS_URL:'https://volt.sonnycourt.com/c/delta-vision',MAILERLITE_API_KEY:'mock'};
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const request=(body,origin='https://sonnycourt.com')=>new Request('https://sonnycourt.com/.netlify/functions/delta-gifts',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
let token='';
for(const exists of [true,false]){
 let reads=0;
 const response=await api(request({action:'owner_email_access',email:' BUYER@example.com '}),null,{env,fetcher:async(url,options)=>{
  assert.equal(options.method,'GET','Opening the portal must not write data or send email');reads++;
  const u=new URL(url);assert.equal(u.origin,env.SUPABASE_URL);
  if(u.pathname.endsWith('/dv_gift_orders')){
   assert.equal(u.searchParams.get('buyer_email'),'eq.buyer@example.com');
   assert.equal(u.searchParams.get('status'),'eq.paid');
   return Response.json(exists?[{id,pack_count:1},{id:other,pack_count:3}]:[]);
  }
  assert(u.pathname.endsWith('/dv_gifts'));
  assert([`eq.${id}`,`eq.${other}`].includes(u.searchParams.get('order_id')));
  return Response.json([{slot:1,state:'available'}]);
 }});
 const body=await response.json();assert.equal(response.status,exists?200:404);
 if(exists){assert.equal(body.orders.length,2);token=body.token;assert.equal(verifyGiftBuyerToken(token,{env}),'buyer@example.com');assert.equal(reads,3);}
 else{assert.equal(body.code,'purchase_not_found');assert(!body.token);assert.equal(reads,1);}
}
for(const email of ['',null,'bad','x'.repeat(255)+'@example.com']){
 const response=await api(request({action:'owner_email_access',email}),null,{env,fetcher:async()=>{throw new Error('Invalid email must not reach database');}});
 assert.equal(response.status,400);
}
assert.equal((await api(request({action:'owner_email_access',email:'buyer@example.com'},'https://other.test'),null,{env})).status,403);
// An email-issued token cannot assign gifts belonging to a different buyer.
const denied=await api(request({action:'assign',token,orderId:other,recipients:[{slot:1,firstName:'Friend',email:'friend@example.com'}]}),null,{env,fetcher:async(url,options)=>{
 assert.equal(options.method,'GET');return Response.json([{id:other,buyer_email:'someoneelse@example.com',status:'paid',pack_count:3}]);
}});assert.equal(denied.status,403);
let assigned=0;
const accepted=await api(request({action:'assign',token,orderId:id,recipients:[{slot:1,firstName:'Friend',email:'friend@example.com'}]}),null,{env,fetcher:async(url,options)=>{
 if(url.endsWith('/rpc/dv_gift_assign')){assigned++;assert.equal(JSON.parse(options.body).p_order,id);return Response.json(1);}
 if(url.includes('/dv_gift_orders?'))return Response.json([{id,buyer_email:'buyer@example.com',status:'paid',pack_count:1}]);
 return Response.json([{slot:1,state:'assigned',recipient_name:'Friend',recipient_email:'friend@example.com'}]);
}});assert.equal(accepted.status,200);assert.equal(assigned,1);
const page=readFileSync('src/pages/delta-vision-cadeaux.astro','utf8');
assert(page.includes("action:'owner_email_access'"));assert(page.includes('token=result.token;render(result)'));
assert(!page.includes("action:'recover'"));assert(!page.includes('Retrouver mon lien personnel'));
console.log('PASS direct buyer access: normalized email, paid purchases only, no writes/emails on access, invalid/unknown addresses, origin guard, signed assignment scope, existing UI integration. All mocked.');
