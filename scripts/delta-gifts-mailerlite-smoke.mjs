import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {signGiftBuyerToken,verifyGiftBuyerToken} from '../netlify/functions/lib/delta-gifts.mjs';
import {handoffGiftEmail,giftMailerLiteChannel} from '../netlify/functions/lib/delta-gifts-mailerlite.mjs';
import api from '../netlify/functions/delta-gifts.js';
const now=Date.now(),id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const env={DELTA_GIFTS_ENABLED:'true',DELTA_GIFTS_EMAILS_APPROVED:'true',DELTA_GIFTS_CIRCLE_APPROVED:'true',SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'mock',DELTA_GIFTS_SIGNING_KEY:'s'.repeat(64),DELTA_GIFTS_WEBHOOK_TOKEN:'w'.repeat(64),DELTA_GIFTS_CHECKOUT_ID:'41041',DELTA_GIFTS_AMOUNT_UNIT:'minor',CIRCLE_ADMIN_API_TOKEN:'mock',DELTA_GIFTS_CIRCLE_GROUP_ID:'42',DELTA_GIFTS_CIRCLE_SPACE_IDS:'101',CIRCLE_COMMUNITY_HOST:'volt.sonnycourt.com',DELTA_GIFTS_ACCESS_URL:'https://volt.sonnycourt.com/c/delta-vision',MAILERLITE_API_KEY:'mock',DELTA_GIFTS_MAILERLITE_EMAILS_ENABLED:'true',DELTA_GIFTS_ML_OWNER_GROUP:'123',DELTA_GIFTS_ML_OWNER_AUTOMATION:'456'};
const token=signGiftBuyerToken(' Buyer@example.com ',{env,now});
assert.equal(verifyGiftBuyerToken(token,{env,now}),'buyer@example.com');
assert.equal(verifyGiftBuyerToken(token+'x',{env,now}),null);
assert.equal(verifyGiftBuyerToken(token,{env,now:now+31*86400000}),null);
const request=body=>new Request('https://sonnycourt.com/.netlify/functions/delta-gifts',{method:'POST',headers:{Origin:'https://sonnycourt.com','Content-Type':'application/json'},body:JSON.stringify(body)});
let writes=0;
const denial=await api(request({action:'assign',token,orderId:other,recipients:[{slot:1,email:'friend@example.com'}]}),null,{env,fetcher:async(url,opts)=>{if(opts.method!=='GET')writes++;return Response.json([{id:other,buyer_email:'different@example.com',status:'paid',pack_count:1}]);}});
assert.equal(denial.status,403);assert.equal(writes,0);
const portal=await api(request({action:'owner',token}),null,{env,fetcher:async url=>{
 const u=new URL(url);if(u.pathname.endsWith('/dv_gift_orders')){assert.equal(u.searchParams.get('buyer_email'),'eq.buyer@example.com');assert.equal(u.searchParams.get('status'),'eq.paid');return Response.json([{id,pack_count:3},{id:other,pack_count:1}]);}
 assert(u.searchParams.get('order_id')===`eq.${id}`||u.searchParams.get('order_id')===`eq.${other}`);return Response.json([{slot:1,state:'available'}]);
}});assert.equal((await portal.json()).orders.length,2);
const order={id,buyer_email:'buyer@example.com',buyer_name:'Buyer'},job={id:other,kind:'owner_email',job_key:`owner:${id}`,attempts:1};
assert.equal(giftMailerLiteChannel({...job,job_key:'recover:test'},env).key,'DELTA_GIFTS_ML_OWNER_RECOVERY');
for(const scenario of ['disabled','paused','unsubscribed','cooldown','ambiguous','success']){
 const calls=[];
 const fetcher=async(url,opts)=>{
  const u=new URL(url);assert(!u.hostname.includes('mailersend'));calls.push({path:u.pathname,method:opts.method});
  if(u.pathname.endsWith('/automations/456'))return Response.json({data:{enabled:scenario!=='paused',complete:true,trigger_data:{repeatable:true},triggers:[{type:'subscriber_joins_group',group_ids:['123']}],steps:[{type:'email',complete:true}]}});
  if(u.pathname.endsWith('/dv_gift_orders'))return Response.json([{id}]);
  if(u.pathname.endsWith('/dv_gift_jobs'))return Response.json(scenario==='cooldown'?[{completed_at:new Date(now-1000).toISOString()}]:[]);
  if(u.pathname.includes('/subscribers/buyer%40'))return Response.json({data:{id:'789',status:scenario==='unsubscribed'?'unsubscribed':'active',groups:scenario==='ambiguous'?[{id:'123'}]:[]}});
  if(u.pathname.endsWith('/subscribers/789'))return Response.json({data:{id:'789',status:'active',groups:scenario==='ambiguous'?[{id:'123'}]:[]}});
  if(u.pathname.endsWith('/groups/123'))return new Response(null,{status:204});
  throw new Error('unexpected mock request');
 };
 const action=()=>handoffGiftEmail({...job,attempts:scenario==='ambiguous'?2:1},order,null,{env:{...env,DELTA_GIFTS_MAILERLITE_EMAILS_ENABLED:scenario==='disabled'?'false':'true'},fetcher,now});
 if(['disabled','paused','unsubscribed','ambiguous'].includes(scenario))await assert.rejects(action,/gift_mailerlite_/);
 else if(scenario==='cooldown')assert.equal((await action()).deferUntil,new Date(now-1000+86460000).toISOString());
 else assert.deepEqual(await action(),{handedOff:true});
 if(scenario!=='success')assert(!calls.some(c=>c.path.endsWith('/groups/123')));
 if(scenario==='disabled')assert.equal(calls.length,0);
 if(scenario==='unsubscribed')assert(!calls.some(c=>c.method!=='GET'));
}
assert(!readFileSync('netlify/functions/lib/delta-gifts-worker.mjs','utf8').toLowerCase().includes('mailersend'));
console.log('PASS MailerLite gifts: private all-purchase portal, cross-buyer denial, token expiry, no MailerSend, workflow guard, unsubscribed protection, cooldown and ambiguous retry protection. No real messages.');
