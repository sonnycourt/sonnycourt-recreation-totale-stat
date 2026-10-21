import assert from 'node:assert/strict';
import { makePremiumBilling, isPremiumPayment } from '../netlify/functions/lib/es2-premium-billing.mjs';
const order = { id: 123, checkout: {id: 41175}, customer: {email:'test@example.com'}, payment_status:'succeeded', payments:[{order_id:123,status:'succeeded',currency:'eur',amount_paid:19700,amount_refunded:0}] };
assert(isPremiumPayment(order, '123', 'test@example.com'));
assert(!isPremiumPayment(order, '124', 'test@example.com'));
assert(!isPremiumPayment(order, '123', 'other@example.com'));
assert(!isPremiumPayment({...order, checkout:{id:40006}}, '123','test@example.com'));
assert(!isPremiumPayment({...order, payments:[{...order.payments[0],amount_refunded:19700}]},'123','test@example.com'));
assert(!isPremiumPayment({...order, checkout:{id:41049}}, '123','test@example.com')); // Delta alone is not ES2.
const native = {...order, checkout:{id:41049},
  detail:{line_items:[{order_item_id:500,block_type:'upsell',name:'Esprit Subconscient 2.0 (Paiement unique)',amount:129700}]},
  items:[{id:500,payment_ids:[900]}],
  payments:[{...order.payments[0],id:900,amount_paid:129700}]};
assert(isPremiumPayment(native, '123','test@example.com'));
assert(isPremiumPayment({...native,checkout:{id:41096}}, '123','test@example.com'));
assert(!isPremiumPayment({...native,items:[]}, '123','test@example.com'));
assert(!isPremiumPayment({...native,detail:{line_items:[]}}, '123','test@example.com'));
assert(!isPremiumPayment({...native,items:[{id:500,payment_ids:[901]}]}, '123','test@example.com'));
assert(!isPremiumPayment({...native,detail:{line_items:[{...native.detail.line_items[0],is_refunded_by_spiffy:true}]}}, '123','test@example.com'));
const approvedTest = {...native,id:2554891,customer_id:1909343,
  detail:{line_items:[{...native.detail.line_items[0],amount:150,product_option_price_id:881271}]},
  items:[{id:500,payment_ids:[4900437]}],
  payments:[{...order.payments[0],id:4900437,order_id:2554891,amount_paid:150}]};
assert(isPremiumPayment(approvedTest, '2554891','test@example.com'));
assert(!isPremiumPayment({...approvedTest,customer_id:999}, '2554891','test@example.com'));
assert(!isPremiumPayment({...approvedTest,id:2554892}, '2554892','test@example.com'));
assert(!isPremiumPayment({...approvedTest,payments:[{...approvedTest.payments[0],amount_refunded:150}]}, '2554891','test@example.com'));
const monthlyTest = {...order,id:2554945,customer_id:1909375,
  detail:{line_items:[{order_item_id:4968860,product_option_price_id:881386,amount:1500}]},
  items:[{id:4968860,payment_ids:[4900527]}],
  payments:[{...order.payments[0],id:4900527,order_id:2554945,amount_paid:148}]};
assert(isPremiumPayment(monthlyTest,'2554945','test@example.com'));
assert(!isPremiumPayment({...monthlyTest,id:2554946},'2554946','test@example.com'));
assert(!isPremiumPayment({...monthlyTest,customer_id:999},'2554945','test@example.com'));
assert(!isPremiumPayment({...monthlyTest,items:[]},'2554945','test@example.com'));
assert(!isPremiumPayment({...monthlyTest,detail:{line_items:[]}},'2554945','test@example.com'));
assert(!isPremiumPayment({...monthlyTest,payments:[{...monthlyTest.payments[0],id:1}]},'2554945','test@example.com'));
assert(!isPremiumPayment({...monthlyTest,payments:[{...monthlyTest.payments[0],amount_refunded:148}]},'2554945','test@example.com'));
const writes=[];
const service=makePremiumBilling({read:async()=>({data:order}),save:async(...args)=>writes.push(args),uuid:()=> 'test-id',now:()=> '2026-10-20T00:00:00Z'});
const base={order:'123',email:'test@example.com'};
assert.deepEqual((await service({...base,action:'status'})).data,{paid:true});
assert.equal(writes.length,0);
assert.equal((await service({...base,action:'complete'})).status,400);
assert.equal((await service({...base,action:'complete',first_name:'Test',last_name:'Buyer',phone:'000',street:'Street',zip:'123',city:'City',country:'FR'})).data.ok,true);
assert.equal(writes.length,1);
assert.equal(writes[0][0],'123/test-id');
assert.equal(writes[0][1].source,'customer_submitted');
assert.equal((await service({...base,email:'other@example.com',action:'complete'})).data.paid,false);
assert.equal(writes.length,1);
assert.equal((await service({...base,email:'other@example.com',action:'status'})).data.retryable,false);
const pendingService=makePremiumBilling({read:async()=>({data:{...order,payment_status:'pending'}})});
assert.equal((await pendingService({...base,action:'status'})).data.retryable,true);
console.log('Premium billing: paid-order checks, no personal-data disclosure, no CRM overwrite and isolated submission verified.');
