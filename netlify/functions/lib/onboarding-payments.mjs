import {createHash} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {spiffyFacts,paymentSummary,PLAN_AMOUNTS} from './onboarding-payments-domain.mjs';

const TTL=30*60*1000;
const numeric=v=>/^\d+$/.test(String(v));
const quote=v=>`"${String(v).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
const cache=()=>getStore('onboarding-payment-snapshots');
const defaultCache={get:async key=>{try{return await cache().get(key,{type:'json'});}catch{return null;}},set:async(key,value)=>{try{await cache().setJSON(key,value);}catch{/* La lecture Spiffy reste utilisable. */}}};

export async function spiffyRead(path,params={}) {
  const key=String(process.env.SPIFFY_ONBOARDING_API_KEY||'').trim();
  if(!key)throw new Error('spiffy_not_configured');
  if(!/^orders(?:\/\d+)?$/.test(path)&&!['payments','customers'].includes(path))throw new Error('invalid_read');
  const url=new URL(`https://api.spiffy.co/v2/${path}`);
  for(const [name,value]of Object.entries(params))url.searchParams.set(name,String(value));
  const response=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('spiffy_unavailable');
  return response.json();
}
async function allPages(read,path,params){
  const rows=[];let total=null;
  for(let page=1;page<=10;page++){
    const data=await read(path,{...params,page,per_page:100});
    const count=data.meta?.pagination?.total_count??data.pagination?.total;
    if(!Array.isArray(data.data)||!Number.isInteger(count)||count<0)throw new Error('incomplete_data');
    if(total!==null&&total!==count)throw new Error('changing_data');
    total=count;rows.push(...data.data);
    if(rows.length===total)return rows;
    if(!data.data.length||rows.length>total)throw new Error('incomplete_data');
  }
  throw new Error('data_limit');
}

export async function loadOnboardingPayments(db,scope,{read=spiffyRead,store=defaultCache,now=Date.now()}={}) {
  const started=Date.now();
  const boundedRead=(path,params)=>{if(Date.now()-started>22000)throw new Error('time_limit');return read(path,params);};
  const cases=[];
  for(let offset=0;;offset=cases.length){
    const rows=await db(`onboarding_cases?select=id,registration_id,email,display_name,preferred_name,country,country_override,plan,purchased_at,source${scope}&order=id.asc&limit=1000&offset=${offset}`);
    if(!Array.isArray(rows))throw new Error('cases_unavailable');
    if(!rows.length)break;cases.push(...rows);
    if(cases.length>500)throw new Error('payment_view_limit');
  }
  const linked=cases.filter(c=>Number.isSafeInteger(c.registration_id));
  const registrations=linked.length?await db(`mc2_registrations?id=in.(${linked.map(c=>c.registration_id).join(',')})&select=id,token`):[];
  const events=registrations.length?await db(`mc2_funnel_events?token=in.(${registrations.map(r=>encodeURIComponent(quote(r.token))).join(',')})&event_name=eq.purchase_completed&metadata->>provider=eq.spiffy&select=token,metadata&limit=1000`):[];
  if(events.length>=1000)throw new Error('event_limit');
  const tokens=new Map(registrations.map(r=>[r.id,r.token]));
  const results=new Array(cases.length);let cursor=0;
  async function worker(){
    while(cursor<cases.length){
      const i=cursor++,c=cases[i];
      const base={case_id:c.id,name:c.preferred_name||c.display_name,country:c.country_override||c.country,plan:c.plan,
        amount_minor:PLAN_AMOUNTS[c.plan],currency:'EUR',available:false,first_status:'unknown',next_status:'unknown',paid_count:null};
      const orderIds=[...new Set(events.filter(e=>e.token===tokens.get(c.registration_id)).map(e=>e.metadata?.order_id).filter(numeric).map(String))];
      const cacheKey=createHash('sha256').update(JSON.stringify([c.id,c.email,c.plan,c.purchased_at,orderIds])).digest('hex');
      const previous=await store.get(cacheKey).catch(()=>null);
      if(previous?.version===1&&Date.parse(previous.facts.checked_at)>now-TTL){results[i]={...base,...previous.facts,available:true,stale:false};continue;}
      try{
        let orderId;
        if(c.source==='mc2'){
          if(orderIds.length!==1)throw new Error('ambiguous_order');orderId=orderIds[0];
        }else{
          const customers=await allPages(boundedRead,'customers',{'filter[email]':c.email});
          if(customers.length!==1||!numeric(customers[0].id)||String(customers[0].email).trim().toLowerCase()!==String(c.email).trim().toLowerCase())throw new Error('ambiguous_customer');
          const customerId=String(customers[0].id);
          const orders=await allPages(boundedRead,'orders',{'filter[customer_id]':customerId});
          if(orders.some(o=>String(o.customer_id)!==customerId))throw new Error('unverified_customer_orders');
          const candidates=orders.filter(o=>Math.abs(Date.parse(o.created_at)-Date.parse(c.purchased_at))<=86400000);
          if(candidates.length!==1||!numeric(candidates[0].id))throw new Error('ambiguous_order');orderId=String(candidates[0].id);
        }
        const response=await boundedRead(`orders/${orderId}`,{include:'subscriptions,paymentplans,items'});
        const order=response?.data&&!Array.isArray(response.data)?response.data:response;
        if(String(order.id)!==orderId)throw new Error('unverified_order');
        order.payments=await allPages(boundedRead,'payments',{'filter[order_id]':orderId});
        if(order.payments.some(p=>String(p.order_id)!==orderId))throw new Error('unverified_payments');
        const facts=spiffyFacts(order,c,now);
        results[i]={...base,...facts,available:true,stale:false};
        await store.set(cacheKey,{version:1,facts}).catch(()=>{});
      }catch{
        results[i]=previous?.version===1?{...base,...previous.facts,available:true,stale:true}:base;
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(3,cases.length)},worker));
  results.sort((a,b)=>(Date.parse(a.next_date)||Infinity)-(Date.parse(b.next_date)||Infinity)||String(a.name||'').localeCompare(String(b.name||''),'fr'));
  return {rows:results,summary:paymentSummary(results,now),source:'Spiffy',refreshedAt:new Date(now).toISOString(),cacheMinutes:30};
}
