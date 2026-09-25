import assert from 'node:assert/strict';
import { verifiedEntryPayment, confirmMc2EntryPayment } from '../netlify/functions/lib/mc2-entry-payment.mjs';
import { mc2EntryPaymentPending, MC2_ENTRY_CHECKOUT_ID } from '../src/lib/mc2-entry-payment.mjs';
import { buildEntrySpiffyUrl, trustedSpiffyMessage } from '../src/lib/mc2-entry-spiffy.mjs';
import { mc2SessionEmailJobs } from '../netlify/functions/lib/mc2-session-emails.mjs';
import { mc2RecoverySegment, mc2RecoveryMessageTypes } from '../netlify/functions/lib/mc2-replay-recovery.mjs';

const row = { token:'11111111-2222-4333-8444-555555555555', email:'test@example.invalid', telephone:'+33612345678', pays:'France', registered_at:'2026-09-25T10:00:00Z', entry_payment_required:true };
const order = { id:100, customer_id:20, currency:'EUR', created_at:'2026-09-25T10:10:00Z', checkout:{id:Number(MC2_ENTRY_CHECKOUT_ID)} };
const payment = { id:10, order_id:100, currency:'EUR', status:'succeeded', amount:2700, amount_paid:2700, amount_refunded:0, created_at:'2026-09-25T10:11:00Z' };
assert.equal(mc2EntryPaymentPending({}),false);
assert.equal(mc2EntryPaymentPending(row),true);
assert.deepEqual(mc2SessionEmailJobs({...row,session_starts_at:'2026-09-26T18:00:00Z'}),[]);
assert.equal(mc2RecoverySegment(row),null);
assert.deepEqual(mc2RecoveryMessageTypes(row),[]);
assert.equal(mc2EntryPaymentPending({...row,entry_payment_paid_at:payment.created_at}),false);
assert.ok(verifiedEntryPayment(order,[payment],row,20));
for(const change of [{status:'pending'},{status:'failed'},{status:'refunded'},{amount_refunded:1},{amount_paid:0},{amount:19700},{currency:'USD'},{order_id:999},{is_manual:true}]) {
  assert.equal(verifiedEntryPayment(order,[{...payment,...change}],row,20),null,JSON.stringify(change));
}
for(const change of [{customer_id:21},{checkout:{id:40406}},{currency:'USD'},{created_at:'2026-09-20T10:00:00Z'}]) assert.equal(verifiedEntryPayment({...order,...change},[payment],row,20),null);
assert.equal(verifiedEntryPayment(order,[payment,{...payment,id:11,status:'disputed'}],row,20),null);
assert.equal(verifiedEntryPayment(order,[payment],{...row,telephone:null},20),null);
const envelope = data => ({data,meta:{pagination:{total_count:data.length}}});
const calls=[];let updates=0,completions=0;
const options={
  read:async(path,params)=>{calls.push([path,params]);if(path==='customers')return envelope([{id:20,email:row.email}]);if(path==='orders')return envelope([order]);if(path==='orders/100')return {data:order};if(path==='payments')return envelope([payment]);throw Error('unexpected read');},
  patch:async(table,query,change)=>{updates++;assert.equal(table,'mc2_registrations');assert.match(query,/entry_payment_paid_at=is.null/);assert.equal(change.statut,'registered');assert.equal(change.entry_payment_order_id,'100');assert.ok(!('purchased_at'in change));assert.ok(!('payment_status'in change));return {ok:true,data:[{...row,...change}]};},
  complete:async(req,confirmed)=>{completions++;assert.ok(confirmed.entry_payment_paid_at);},
};
assert.equal((await confirmMc2EntryPayment(new Request('https://example.invalid'),row,options)).paid,true);
assert.equal(updates,1);assert.equal(completions,1);
assert.equal(calls.find(c=>c[0]==='orders')[1].include,'checkout');
assert.equal((await confirmMc2EntryPayment(null,{...row,entry_payment_paid_at:payment.created_at},options)).paid,true);
assert.equal(updates,1,'Already paid does not write twice');
assert.equal((await confirmMc2EntryPayment(null,{...row,entry_payment_required:false},options)).historical,true);
const url=buildEntrySpiffyUrl({checkoutUrl:'https://sonnycourt.spiffy.co/checkout/masterclass-es2-27',count:1},{firstName:'Test',email:row.email,registrationToken:row.token},'https://sonnycourt.com/meta/mc2/');
assert.equal(url.searchParams.get('mc2_entry'),'1');assert.equal(url.searchParams.get('email'),row.email);assert.equal(url.searchParams.has('coupon'),false);
assert.throws(()=>buildEntrySpiffyUrl({checkoutUrl:'https://sonnycourt.spiffy.co/checkout/38556364'}, {}, 'https://sonnycourt.com'));
const frame={contentWindow:{}};
assert.equal(trustedSpiffyMessage({origin:'https://evil.invalid',source:frame.contentWindow,data:{type:'mc2:entry-spiffy-ready'}},frame),null);
assert.equal(trustedSpiffyMessage({origin:'https://sonnycourt.spiffy.co',source:{},data:{type:'mc2:entry-spiffy-ready'}},frame),null);
assert.equal(trustedSpiffyMessage({origin:'https://sonnycourt.spiffy.co',source:frame.contentWindow,data:{event:'redirect',url:'https://evil.invalid'}},frame),null);
assert.ok(trustedSpiffyMessage({origin:'https://sonnycourt.spiffy.co',source:frame.contentWindow,data:{event:'redirect',url:'https://sonnycourt.com/mc2/confirmation/'}},frame)?.redirect);
console.log('MC2 entry payment: verified 27 EUR only, wrong/failed/refunded orders denied, historical access preserved, idempotency and iframe origin guards OK');
