import assert from 'node:assert/strict';
import { makeReceiptService, orderMatchesReceipt, validReceipt } from '../netlify/functions/lib/es2-special-receipt.mjs';
import { buildDraftXSpiffyUrl } from '../src/lib/es2-special-spiffy.mjs';
import { DRAFTX_PAYMENT_PLANS } from '../src/lib/es2-special-checkout.mjs';
const at = Date.parse('2026-10-04T18:01:00+02:00');
const memory = new Map(); let writes = 0, order;
const service = makeReceiptService({ now: () => at, get: async key => memory.get(key), set: async (key,v) => memory.set(key,structuredClone(v)),
  read: async path => path === 'customers' ? {data:[{id:1,email:'buyer@example.invalid'}]} : path === 'orders' ? {data:order?[order]:[]} : {data:order},
  dbGet: async () => ({ok:true,data:[{token:'existing-token'}]}), dbPatch: async () => { writes++; return {ok:true}; },
});
assert.equal((await service({action:'prepare',email:'bad',firstName:'Test',plan:'once'})).status,400);
const prepared = await service({action:'prepare',email:'buyer@example.invalid',firstName:'Test',plan:'once'});
const {token,reference} = prepared.data;
assert.ok(validReceipt(token)); assert.notEqual(token,reference);
const receipt = memory.get(token);
assert.equal((await service({action:'status',token})).data.paid,false);
order = {id:7,customer:{email:receipt.email},checkout:{id:40007},created_at:new Date(at).toISOString(),payment_status:'succeeded',attribution:{last:{utm_content:reference}},payments:[{order_id:7,status:'succeeded',currency:'eur',amount_paid:129700,amount_refunded:0}]};
assert.ok(orderMatchesReceipt(order,receipt,token));
for(const bad of [{...order,attribution:{}},{...order,customer:{email:'other@example.invalid'}},{...order,checkout:{id:40006}},{...order,payment_status:'failed'},{...order,payments:[]},{...order,payments:[{...order.payments[0],amount_paid:1}]},{...order,payments:[{...order.payments[0],amount_refunded:129700}]}]) assert.equal(orderMatchesReceipt(bad,receipt,token),false);
assert.equal((await service({action:'status',token})).data.paid,true);
assert.equal(writes,0);
assert.equal((await service({action:'complete',token})).status,400);
assert.equal((await service({action:'complete',token,first_name:'Test',last_name:'Buyer',phone:'+41780000000',street:'1 Test',zip:'1000',city:'Lausanne',country:'CH'})).data.ok,true);
assert.equal(writes,2);
assert.equal((await service({action:'status',token:reference})).status,400);
const url = buildDraftXSpiffyUrl(DRAFTX_PAYMENT_PLANS.once,{firstName:'Test',email:receipt.email,registrationToken:reference},'https://sonnycourt.com/es2-offre-speciale/');
assert.equal(url.searchParams.has('mc2_token'),false);
assert.equal(url.searchParams.get('utm_content'),reference);
assert.equal(url.toString().includes(token),false);
console.log('PASS: public checkout, private receipt, paid-order correlation, wrong buyer/checkout/refund rejection, billing and Evergreen token isolation.');
