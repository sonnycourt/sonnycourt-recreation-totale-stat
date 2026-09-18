// Données financières uniquement issues de Spiffy ; jamais du statut d'achat à 0 €.
export const PLAN_AMOUNTS={twelve:19700,six:34700,legacy_three:76700};
const time=v=>Number.isFinite(Date.parse(v))?Date.parse(v):0;
const iso=v=>time(v)?new Date(v).toISOString():null;
const id=v=>String(v??'');
export function paymentCycles(payments,amount) {
  const groups=new Map();
  for(const p of payments){
    if(!p||String(p.currency).toLowerCase()!=='eur'||Number(p.amount)!==amount||p.is_startup_fee||p.is_manual)continue;
    const root=id(p.initial_payment_id||p.id);if(!root)continue;
    const group=groups.get(root)||[];group.push(p,...(p.attempts||[]).map(a=>({...a,currency:a.currency||p.currency})));groups.set(root,group);
  }
  return [...groups.entries()].map(([root,rows])=>{
    const unique=[...new Map(rows.filter(p=>String(p.currency).toLowerCase()==='eur'&&Number(p.amount)===amount).map(p=>[id(p.id),p])).values()];
    const original=unique.find(p=>id(p.id)===root)||unique[0];
    const paid=unique.filter(p=>Number(p.amount_paid)>=amount);
    const reversed=unique.find(p=>['refunded','disputed','dispute_refunded'].includes(p.status)||Number(p.amount_refunded)>0);
    const success=paid.find(p=>p.status==='succeeded'&&Number(p.amount_refunded||0)===0);
    const latest=[...unique].sort((a,b)=>time(b.created_at)-time(a.created_at))[0];
    const chosen=reversed||success||latest;
    const state=reversed?(reversed.status==='disputed'?'disputed':'refunded'):success?'paid':latest?.status==='failed'?'failed':'pending';
    return {root,state,created_at:iso(original?.created_at),date:iso(chosen?.created_at),retry_pending:!!latest?.has_pending_retry};
  }).sort((a,b)=>time(a.created_at)-time(b.created_at)||a.root.localeCompare(b.root));
}

export function spiffyFacts(order,caseRow,now=Date.now()) {
  const amount=PLAN_AMOUNTS[caseRow.plan];
  if(!amount||!order||!Array.isArray(order.payments)||String(order.currency).toLowerCase()!=='eur')throw new Error('unverified_order');
  const contracts=caseRow.plan==='legacy_three'?order.paymentplans:order.subscriptions;
  if(!Array.isArray(contracts)||contracts.length!==1)throw new Error('ambiguous_contract');
  const contract=contracts[0];
  if(id(contract.order_id)!==id(order.id))throw new Error('unverified_contract');
  // Un ancien échéancier peut inclure sa ligne de frais de financement.
  // Toutes les lignes doivent alors appartenir au même échéancier vérifié.
  if(!Array.isArray(order.items)||!order.items.length)throw new Error('ambiguous_items');
  if(order.items.length!==1&&!(caseRow.plan==='legacy_three'&&Array.isArray(contract.item_ids)&&order.items.every(item=>contract.item_ids.map(id).includes(id(item.id)))&&contract.item_ids.length===order.items.length))throw new Error('ambiguous_items');
  if(caseRow.plan!=='legacy_three'&&contract.price&&Number(contract.price.amount)!==amount)throw new Error('unverified_price');
  if(contract.discounts?.length)throw new Error('unverified_discount');
  // Un changement de montant ou un encaissement manuel exige une vérification,
  // plutôt qu'un faux "à venir" obtenu en ignorant cette transaction.
  const contractPaymentIds=new Set((contract.payment_ids||[]).map(id));
  if(order.payments.some(p=>Number(p.amount)>0&&(Number(p.amount)!==amount||String(p.currency).toLowerCase()!=='eur'||(p.is_manual&&!contractPaymentIds.has(id(p.id)))||p.is_startup_fee)))throw new Error('unverified_amount');
  // Spiffy marque le premier paiement de l'ancien plan "manual" : il compte
  // uniquement si l'échéancier le référence explicitement, jamais par supposition.
  const cycles=paymentCycles(order.payments.map(p=>p.is_manual&&contractPaymentIds.has(id(p.id))?{...p,is_manual:false}:p),amount);
  const receivedIds=new Set(order.payments.flatMap(p=>[p.id,...(p.attempts||[]).map(a=>a.id)]).map(id));
  if([...contractPaymentIds].some(n=>!receivedIds.has(n)))throw new Error('incomplete_contract_payments');
  if(cycles.some(c=>!c.created_at))throw new Error('unverified_chronology');
  const first=cycles[0];
  const terminal=['canceled','cancelled','swapped','completed','defaulted'].includes(contract.status);
  const nextDate=!terminal?iso(contract.next_payment_at):null;
  let firstState=first?.state;
  if(!firstState)firstState=terminal?'stopped':nextDate&&time(nextDate)>now?'upcoming':'pending';
  const latest=cycles.at(-1);
  return {first_status:firstState,first_date:first?.date||nextDate,paid_count:cycles.filter(p=>p.state==='paid').length,
    next_date:nextDate,next_status:terminal?'stopped':latest?.state==='failed'?'failed':nextDate&&time(nextDate)>now?'upcoming':'pending',
    amount_minor:amount,currency:'EUR',checked_at:new Date(now).toISOString()};
}

export function paymentSummary(rows,now=Date.now()) {
  const cohort=rows.filter(r=>r.plan==='twelve');
  const known=cohort.filter(r=>r.available&&!r.stale);
  const upcoming=known.filter(r=>r.next_status==='upcoming'&&time(r.next_date)>now&&time(r.next_date)<=now+7*86400000);
  return {cohort:cohort.length,first_paid:known.filter(r=>r.first_status==='paid').length,
    first_failed:known.filter(r=>r.first_status==='failed').length,upcoming_count:upcoming.length,
    upcoming_minor:upcoming.reduce((n,r)=>n+r.amount_minor,0),unverified:cohort.length-known.length};
}
