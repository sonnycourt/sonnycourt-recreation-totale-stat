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
 if(process.argv[3]){
   const r=await fetch(`https://api.spiffy.co/v2/payments?filter%5Border_id%5D=${id}&per_page=100`,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw new Error('payments_unavailable');const ps=await r.json();
   if(ps.data.length!==ps.meta?.pagination?.total_count)throw new Error('incomplete_payments');o.payments=ps.data;
   const facts=projectPayments(o,{order_id:id,plan:process.argv[4]||'twelve',purchased_at:process.argv[3]});
   console.log(JSON.stringify({mode:'read_only_no_writes',contract_status:facts.contract_status,ledger_count:facts.ledger.length,events:facts.events.map(e=>({name:e.event_name,amount:e.amount_minor,time:e.event_time}))},null,2));process.exit(0);
 }
 console.log(JSON.stringify({keys:Object.keys(o),id:o.id,checkout_id:o.checkout_id,currency:o.currency,created_at:o.created_at,status:o.status,subscriptions:(o.subscriptions||[]).map(s=>({keys:Object.keys(s),status:s.status,order_id:s.order_id,next_payment_at:s.next_payment_at,price:s.price,payment_ids:s.payment_ids})),items:(o.items||[]).map(i=>({keys:Object.keys(i)}))},null,2));process.exit(0);
}
const u=new URL('https://api.spiffy.co/v2/payments');
u.searchParams.set('per_page','5');
const r=await fetch(u,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
if(!r.ok){console.error('provider_status_'+r.status);process.exit(1);}
const body=await r.json();
console.log(JSON.stringify({pagination:body.meta?.pagination||body.pagination,rows:(body.data||[]).map(p=>({keys:Object.keys(p),status:p.status,currency:p.currency,amount:p.amount,amount_paid:p.amount_paid,amount_refunded:p.amount_refunded,dates:Object.fromEntries(Object.entries(p).filter(([k])=>/_at$/.test(k))),attempt_keys:(p.attempts||[]).map(a=>Object.keys(a))}))},null,2));
