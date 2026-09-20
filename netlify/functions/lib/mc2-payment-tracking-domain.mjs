import {createHash} from 'node:crypto';
import {spiffyFacts, PLAN_AMOUNTS} from './onboarding-payments-domain.mjs';
const numeric=v=>/^\d+$/.test(String(v??''));
const stamp=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
export const keyFor=(...parts)=>parts.map(String).join(':');
export function paymentEvent(orderId,name,suffix,date,amount=0) {
  if(!stamp(date)||!Number.isSafeInteger(amount)||amount<0)throw new Error('invalid_event');
  const event_key=keyFor('mc2-finance-v1',orderId,name,suffix);
  return {event_key,order_id:String(orderId),event_name:name,event_id:'mc2-finance-'+createHash('sha256').update(event_key).digest('hex'),event_time:stamp(date),amount_minor:amount,currency:'EUR'};
}

// Pure projection. Never calls a provider, changes an order or guesses a payment.
export function projectPayments(order,source,now=Date.now()) {
  if(!numeric(source.order_id)||String(order.id)!==source.order_id)throw new Error('order_mismatch');
  if(!['twelve','six'].includes(source.plan))throw new Error('unsupported_plan');
  if(order.checkout_id!=null&&String(order.checkout_id)!==({twelve:'40406',six:'40422'}[source.plan]))throw new Error('checkout_mismatch');
  spiffyFacts(order,{plan:source.plan},now); // complete, single contract, amount/currency checks
  const amount=PLAN_AMOUNTS[source.plan];
  const flat=new Map();
  for(const p of order.payments)for(const a of [p,...(p.attempts||[])]){
    const row={...a,order_id:a.order_id??p.order_id,currency:a.currency??p.currency,initial_payment_id:a.initial_payment_id??(a.id!==p.id?p.initial_payment_id||p.id:p.initial_payment_id)};
    if(!numeric(row.id)||String(row.order_id)!==source.order_id)throw new Error('payment_mismatch');
    if(Number(row.amount)===0)continue;
    if(Number(row.amount)!==amount||String(row.currency).toUpperCase()!=='EUR'||row.is_manual||row.is_startup_fee)throw new Error('payment_amount_unverified');
    const existing=flat.get(String(row.id));
    if(existing&&['status','amount_paid','amount_refunded','created_at'].some(k=>String(existing[k])!==String(row[k])))throw new Error('inconsistent_attempt');
    flat.set(String(row.id),row);
  }
  const groups=new Map();
  for(const p of flat.values()){
    let root=p; const seen=new Set();
    while(root.initial_payment_id&&String(root.initial_payment_id)!==String(root.id)){
      if(seen.has(String(root.id)))throw new Error('retry_cycle');seen.add(String(root.id));
      root=flat.get(String(root.initial_payment_id));if(!root)throw new Error('missing_retry_root');
    }
    const id=String(root.id);groups.set(id,[...(groups.get(id)||[]),p]);
  }
  const ledger=[],events=[];
  for(const [root,rows] of groups){
    rows.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
    for(const p of rows){
      if(!stamp(p.created_at)||Date.parse(p.created_at)>now+60000)throw new Error('payment_date_unverified');
      if(!Number.isSafeInteger(p.amount_paid)||!Number.isSafeInteger(p.amount_refunded)||p.amount_paid<0||p.amount_refunded<0||p.amount_paid>amount||p.amount_refunded>p.amount_paid)throw new Error('payment_totals_unverified');
    }
    const paid=rows.filter(p=>p.amount_paid===amount&&['succeeded','refunded','disputed','dispute_refunded'].includes(p.status));
    if(paid.length>1)throw new Error('multiple_collections_for_installment');
    const successful=paid[0],last=successful||rows.at(-1);
    if(!['succeeded','refunded','disputed','dispute_refunded','failed','pending','processing','requires_action'].includes(last.status))throw new Error('unknown_payment_status');
    if(last.status==='succeeded'&&!successful)throw new Error('partial_collection');
    const state=['disputed','dispute_refunded'].includes(last.status)?'disputed':last.amount_refunded>0||last.status==='refunded'?'refunded':successful?'paid':last.status==='failed'?'failed':'pending';
    ledger.push({payment_key:keyFor(source.order_id,root),order_id:source.order_id,root_payment_id:root,provider_payment_id:String(last.id),amount_minor:amount,paid_minor:last.amount_paid,refunded_minor:last.amount_refunded,currency:'EUR',status:state,occurred_at:stamp(last.created_at),checked_at:new Date(now).toISOString()});
    if(successful){
      // Spiffy exposes attempt creation, not a guaranteed capture timestamp.
      // Only automatically send prompt successes. Delayed/edited captures remain
      // in the local ledger pending manual verification; never invent a new date.
      const updated=Date.parse(successful.updated_at),created=Date.parse(successful.created_at);
      if(state==='paid'&&Number.isFinite(updated)&&updated>=created&&updated-created<=600000){
        events.push(paymentEvent(source.order_id,'MC2_PaymentCollected',root,successful.updated_at,amount));
      }
      if(last.amount_refunded>0&&stamp(last.refunded_at))events.push(paymentEvent(source.order_id,'MC2_PaymentRefunded',keyFor(root,last.amount_refunded),last.refunded_at,last.amount_refunded));
      // No reliable disputed_at in Spiffy API: record disputed locally only.
    }
  }
  const subscription=order.subscriptions[0];
  if(!['active','trialing','trial','canceled','cancelled','completed','expired','past_due','unpaid','defaulted','swapped'].includes(subscription.status))throw new Error('contract_status_unverified');
  if(Math.abs(Date.parse(order.created_at)-Date.parse(source.purchased_at))>86400000||!stamp(order.created_at))throw new Error('order_chronology');
  events.unshift(paymentEvent(source.order_id,'MC2_CommitmentConfirmed','initial',source.purchased_at,0));
  return {ledger,events,contract_status:subscription.status};
}
