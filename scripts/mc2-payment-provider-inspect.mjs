// Read-only diagnostic. Never prints credentials, customer identities or card data.
import {execFileSync} from 'node:child_process';
import {projectPayments} from '../netlify/functions/lib/mc2-payment-tracking-domain.mjs';
const cli='/Users/sonnycourt/Documents/sonnycourt-recreation-totale-static/node_modules/.bin/netlify';
let key;
try {
  key=execFileSync(cli,['env:get','SPIFFY_ONBOARDING_API_KEY','--context','production','--scope','functions','--site','0f20b797-5d46-4b6f-96f2-8716f3f6a0e9'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(!key || /\s/.test(key))throw new Error('unavailable');
} catch { console.error('server_key_unavailable'); process.exit(1); }
if(process.argv[2]){
 const id=process.argv[2];if(!/^\d+$/.test(id))throw new Error('invalid_order');
 const r=await fetch(`https://api.spiffy.co/v2/orders/${id}?include=subscriptions,paymentplans,items`,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
 if(!r.ok){console.error('provider_status_'+r.status);process.exit(1);}
 const raw=await r.json(),o=raw.data||raw;
 if(process.argv[3]==='entry'){
   const pr=await fetch(`https://api.spiffy.co/v2/payments?filter%5Border_id%5D=${id}&per_page=100`,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(!pr.ok)throw new Error('payments_unavailable');const ps=await pr.json();
   console.log(JSON.stringify({order:{id:o.id,customer_id:o.customer_id,checkout_publish_id:o.checkout_publish_id,payment_status:o.payment_status,currency:o.currency,created_at:o.created_at,completed_at:o.completed_at,detail:{total:o.detail?.total,due_today:o.detail?.due_today,line_items:(o.detail?.line_items||[]).map(i=>({keys:Object.keys(i),product_id:i.product_id,product_option_price_id:i.product_option_price_id,price:i.price,amount:i.amount,total:i.total}))},items:(o.items||[]).map(i=>({published_checkout_item_id:i.published_checkout_item_id,product_option_price_id:i.product_option_price_id,price:i.price,base_price:i.base_price,name:i.name}))},payments:(ps.data||[]).map(p=>({keys:Object.keys(p),id:p.id,order_id:p.order_id,status:p.status,currency:p.currency,amount:p.amount,amount_paid:p.amount_paid,amount_refunded:p.amount_refunded,is_manual:p.is_manual,customer_id:p.customer_id,has_gateway_id:/^\d+$/.test(String(p.gateway_id||'')),has_stripe_charge:/^ch_/.test(String(p.stripe_charge_id||'')),has_stripe_intent:/^pi_/.test(String(p.stripe_paymentintent_id||'')),created_at:p.created_at}))},null,2));process.exit(0);
 }
 if(process.argv[3]){
   const r=await fetch(`https://api.spiffy.co/v2/payments?filter%5Border_id%5D=${id}&per_page=100`,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw new Error('payments_unavailable');const ps=await r.json();
   if(ps.data.length!==ps.meta?.pagination?.total_count)throw new Error('incomplete_payments');o.payments=ps.data;
   const facts=projectPayments(o,{order_id:id,plan:process.argv[4]||'twelve',purchased_at:process.argv[3]});
   console.log(JSON.stringify({mode:'read_only_no_writes',contract_status:facts.contract_status,ledger_count:facts.ledger.length,events:facts.events.map(e=>({name:e.event_name,amount:e.amount_minor,time:e.event_time}))},null,2));process.exit(0);
 }
 console.log(JSON.stringify({keys:Object.keys(o),id:o.id,customer_id:o.customer_id,checkout_id:o.checkout_id,checkout_publish_id:o.checkout_publish_id,currency:o.currency,created_at:o.created_at,completed_at:o.completed_at,status:o.status,payment_status:o.payment_status,detail_keys:Object.keys(o.detail||{}),subscriptions:(o.subscriptions||[]).map(s=>({keys:Object.keys(s),status:s.status,order_id:s.order_id,next_payment_at:s.next_payment_at,price:s.price,payment_ids:s.payment_ids})),items:(o.items||[]).map(i=>({keys:Object.keys(i),published_checkout_item_id:i.published_checkout_item_id,product_option_price_id:i.product_option_price_id,payment_ids:i.payment_ids}))},null,2));process.exit(0);
}
const u=new URL('https://api.spiffy.co/v2/payments');
u.searchParams.set('per_page','5');
const r=await fetch(u,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
if(!r.ok){console.error('provider_status_'+r.status);process.exit(1);}
const body=await r.json();
console.log(JSON.stringify({pagination:body.meta?.pagination||body.pagination,rows:(body.data||[]).map(p=>({keys:Object.keys(p),status:p.status,currency:p.currency,amount:p.amount,amount_paid:p.amount_paid,amount_refunded:p.amount_refunded,dates:Object.fromEntries(Object.entries(p).filter(([k])=>/_at$/.test(k))),attempt_keys:(p.attempts||[]).map(a=>Object.keys(a))}))},null,2));
