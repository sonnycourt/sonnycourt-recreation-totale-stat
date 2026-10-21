import assert from 'node:assert/strict';
import { makePremiumBilling, isPremiumPayment } from '../netlify/functions/lib/es2-premium-billing.mjs';
function fixture({id=123, monthly=true, amount=monthly ? 19700 : 129700}={}) {
  const total = monthly ? amount * 12 : amount;
  return {id,checkout:{id:monthly ? 41175 : 41049},customer:{email:'test@example.com'},payment_status:'succeeded',
    detail:{line_items:[{order_item_id:500,total,block_type:monthly ? null : 'upsell',name:monthly ? 'Esprit Subconscient 2.0' : 'Esprit Subconscient 2.0 (Paiement unique)'}]},
    items:[{id:500,payment_ids:[900],price:{option:{product_id:11324}}}],
    paymentplans:monthly ? [{id:700,order_id:id,status:'active',item_ids:[500],payment_ids:[900],detail:{frequency:'month',frequency_count:1,num_payments:12,initial_deposit_amount:0,payment_total_amount:amount,paymentplan_items:[{order_item_id:500,total_due_amount:total,is_finance_fee:false}]}}] : [],
    payments:[{id:900,order_id:id,status:'succeeded',currency:'eur',amount,amount_paid:amount,amount_refunded:0}]};
}
const valid = order => isPremiumPayment(order,String(order.id),'test@example.com');
// New IDs and arbitrary provider-recorded prices, not historical exceptions.
for(const monthly of [true,false]) for(const amount of [148,150,19700,129700]) {
  const order=fixture({id:123456+amount,monthly,amount});assert(valid(order));
  for(const mutate of [
    o=>o.checkout.id=40006, o=>o.customer.email='other@example.com',
    o=>o.payment_status='pending', o=>o.payment_status='refunded',
    o=>o.detail.line_items[0].is_refunded_by_spiffy=true,
    o=>o.detail.line_items[0].is_skipped=true,
    o=>o.items[0].payment_ids=[901], o=>o.payments[0].order_id=999,
    o=>o.payments[0].status='pending', o=>o.payments[0].amount_paid--,
    o=>o.payments[0].amount--, o=>o.payments[0].amount_refunded=1,
    o=>o.payments[0].currency='usd', o=>o.detail.line_items=[], o=>o.items=[],
  ]) { const broken=structuredClone(order); mutate(broken); assert(!valid(broken)); }
}
const order=fixture();assert(!isPremiumPayment(order,'124','test@example.com'));
for(const mutate of [
  o=>o.items[0].price.option.product_id=12015, o=>o.paymentplans=[],
  o=>o.paymentplans[0].payment_ids=[901], o=>o.paymentplans[0].item_ids=[501],
  o=>o.paymentplans[0].order_id=999, o=>o.paymentplans[0].status='canceled',
  o=>o.paymentplans[0].detail.num_payments=3,
  o=>o.paymentplans[0].detail.payment_total_amount=19699,
  o=>o.paymentplans[0].detail.paymentplan_items[0].total_due_amount--,
]) { const broken=structuredClone(order); mutate(broken); assert(!valid(broken)); }
const native=fixture({monthly:false});assert(valid({...native,checkout:{id:41096}}));
const delta=structuredClone(native);delta.detail.line_items[0].name='Delta Vision';assert(!valid(delta));
const unrelated=structuredClone(native);unrelated.payments[0].id=901;assert(!valid(unrelated));
const financed=fixture({amount:148});financed.detail.line_items[0].total=1500;
financed.paymentplans[0].detail.paymentplan_items[0].total_due_amount=1500;
financed.paymentplans[0].detail.paymentplan_items.push({order_item_id:501,total_due_amount:276,is_finance_fee:true});assert(valid(financed));
const writes=[];
const service=makePremiumBilling({read:async(path,options)=>{
  assert(options.include.includes('paymentplans'));return {data:order};
},save:async(...args)=>writes.push(args),uuid:()=> 'test-id',now:()=> '2026-10-21T00:00:00Z'});
const base={order:'123',email:'test@example.com'};
assert.deepEqual((await service({...base,action:'status',amount:1})).data,{paid:true});assert.equal(writes.length,0);
assert.equal((await service({...base,action:'complete'})).status,400);
assert.equal((await service({...base,action:'complete',first_name:'Test',last_name:'Buyer',phone:'000',street:'Street',zip:'123',city:'City',country:'FR'})).data.ok,true);
assert.equal(writes.length,1);assert.equal(writes[0][0],'123/test-id');assert.equal(writes[0][1].source,'customer_submitted');
assert.equal((await service({...base,email:'other@example.com',action:'complete'})).data.paid,false);assert.equal(writes.length,1);
assert.equal((await service({...base,email:'other@example.com',action:'status'})).data.retryable,false);
for(const delayed of [{...order,payment_status:'pending'},{...native,payments:[]}]) {
  const pendingService=makePremiumBilling({read:async()=>({data:delayed})});
  assert.equal((await pendingService({...base,action:'status'})).data.retryable,true);
}
console.log('Premium billing: generic prices, linked ES2 payments, schedule, refunds, delayed sync and immutable submission passed.');
