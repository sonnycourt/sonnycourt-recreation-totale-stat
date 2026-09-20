import {randomUUID} from 'node:crypto';
import {getSupabaseConfig,supabaseHeaders} from './supabase-rest.mjs';
import {sendMetaEvent} from './meta-capi.mjs';
import {projectPayments} from './mc2-payment-tracking-domain.mjs';
const enc=encodeURIComponent;
const prefix='mc2_payment_tracking_';

export async function trackingDb(path,options={}){
  const {url,key}=getSupabaseConfig();if(!url||!key)throw new Error('database_configuration');
  const r=await fetch(`${url}/rest/v1/${path}`,{...options,headers:supabaseHeaders({Prefer:'return=representation',...options.headers}),signal:AbortSignal.timeout(2500)});
  if(!r.ok)throw new Error('tracking_storage_'+r.status);
  return r.status===204?[]:r.json();
}
export async function trackingSpiffy(path,params={}){
  if(!/^orders\/\d+$/.test(path)&&path!=='payments')throw new Error('read_not_allowed');
  const key=process.env.SPIFFY_ONBOARDING_API_KEY;if(!key)throw new Error('provider_configuration');
  const url=new URL('https://api.spiffy.co/v2/'+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  const r=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(3000)});
  if(!r.ok)throw new Error('provider_'+r.status);return r.json();
}
async function payments(read,id){
  const rows=[];let expected;
  for(let page=1;page<=5;page++){
    const body=await read('payments',{'filter[order_id]':id,page,per_page:100});
    const total=body.meta?.pagination?.total_count??body.pagination?.total;
    if(!Array.isArray(body.data)||!Number.isInteger(total)||total<0||(expected!==undefined&&expected!==total))throw new Error('incomplete_payments');
    expected=total;rows.push(...body.data);
    if(rows.length===expected){if(new Set(rows.map(p=>String(p.id))).size!==rows.length)throw new Error('duplicate_page');return rows;}
    if(!body.data.length||rows.length>expected)throw new Error('incomplete_payments');
  }
  throw new Error('payment_page_limit');
}
const post=(db,table,body,merge=false)=>db(table,{method:'POST',headers:{Prefer:`resolution=${merge?'merge':'ignore'}-duplicates,return=representation`},body:JSON.stringify(body)});
const patch=(db,path,body)=>db(path,{method:'PATCH',body:JSON.stringify(body)});

// No caller in checkout, registration, player, webhook, CRM or existing worker.
export async function collectPayments({db=trackingDb,read=trackingSpiffy,now=Date.now(),deployContext=process.env.CONTEXT}={}){
  if(deployContext!=='production')return {skipped:'non_production'};
  const [control]=await db(prefix+'control?id=eq.true');if(!control?.collect_enabled)return {skipped:'disabled'};
  const until=Date.now()+15000,iso=new Date(now).toISOString();
  const result={discovered:0,checked:0,errors:0};
  // Read-only discovery, fair durable scheduling. No trigger on the purchase path.
  const [lastDiscovered]=await db(prefix+'orders?order=purchased_at.desc&limit=1&select=purchased_at');
  const overlap=lastDiscovered?`&occurred_at=gte.${enc(new Date(Date.parse(lastDiscovered.purchased_at)-86400000).toISOString())}`:'';
  const sources=await db('mc2_funnel_events?event_name=eq.purchase_completed&metadata->>provider=eq.spiffy&order=id.desc&limit=1000&select=token,metadata,occurred_at'+overlap);
  if(sources.length===1000)throw new Error('discovery_limit_requires_cursor');
  const seeds=new Map();
  for(const s of sources){
    const m=s.metadata||{},id=String(m.order_id||'');
    if(!/^\d+$/.test(id)||!['twelve','six'].includes(m.plan)||Number(m.amount_cents)!==0)continue;
    if(String(m.checkout_id)!==({twelve:'40406',six:'40422'}[m.plan]))continue;
    const existing=seeds.get(id);if(existing&&existing.token!==s.token)throw new Error('ambiguous_order_identity');
    seeds.set(id,{order_id:id,token:s.token,plan:m.plan,purchased_at:s.occurred_at});
  }
  if(seeds.size){await post(db,prefix+'orders',[...seeds.values()]);result.discovered=seeds.size;}
  const due=await db(prefix+`orders?next_check_at=lte.${enc(iso)}&or=(lease_until.is.null,lease_until.lt.${enc(iso)})&order=next_check_at.asc&limit=1`);
  for(const source of due){
    if(Date.now()>until)break;
    const lease=randomUUID(),filter=`order_id=eq.${enc(source.order_id)}`;
    const claims=await patch(db,prefix+`orders?${filter}&or=(lease_until.is.null,lease_until.lt.${enc(iso)})`,{lease_id:lease,lease_until:new Date(now+120000).toISOString()});
    if(!claims.length)continue;
    const owned=prefix+`orders?${filter}&lease_id=eq.${lease}`;
    try{
      const tests=await db(`mc2_tracking_test_registrations?token=eq.${enc(source.token)}&select=token&limit=1`);
      if(tests.length){await patch(db,owned,{next_check_at:new Date(now+86400000).toISOString(),lease_until:null,lease_id:null,last_error:'test_registration'});continue;}
      const raw=await read('orders/'+source.order_id,{include:'subscriptions,paymentplans,items'});
      const order=raw.data&&!Array.isArray(raw.data)?raw.data:raw;
      order.payments=await payments(read,source.order_id);
      const facts=projectPayments(order,source,now);
      // Queue before ledger. Partial failures are replayable and IDs are stable.
      if(facts.events.length)await post(db,prefix+'outbox',facts.events);
      if(facts.ledger.length)await post(db,prefix+'ledger',facts.ledger,true);
      const nextPayment=Date.parse(order.subscriptions[0].next_payment_at);
      const delay=Number.isFinite(nextPayment)&&nextPayment>now?Math.min(86400000,nextPayment-now+60000):1800000;
      const terminal=['canceled','cancelled','completed','expired','defaulted','swapped'].includes(facts.contract_status);
      await patch(db,owned,{contract_status:facts.contract_status,checked_at:iso,next_check_at:new Date(now+(terminal?86400000:delay)).toISOString(),last_error:null,lease_id:null,lease_until:null});result.checked++;
    }catch(error){
      result.errors++;await patch(db,owned,{last_error:String(error.message).slice(0,100),next_check_at:new Date(now+900000).toISOString(),lease_id:null,lease_until:null});
    }
  }
  return result;
}

export async function deliverPayments({db=trackingDb,send=sendMetaEvent,now=Date.now(),deployContext=process.env.CONTEXT}={}){
  if(deployContext!=='production')return {skipped:'non_production'};
  const [control]=await db(prefix+'control?id=eq.true');if(!control?.send_enabled)return {skipped:'disabled'};
  const iso=new Date(now).toISOString(),until=Date.now()+12000;
  const rows=await db(prefix+`outbox?status=in.(pending,retry,processing)&next_attempt_at=lte.${enc(iso)}&or=(lease_until.is.null,lease_until.lt.${enc(iso)})&order=next_attempt_at.asc&limit=3`);
  const result={sent:0,retry:0,skipped:0};
  for(const row of rows){
    if(Date.now()>until)break;
    const lease=randomUUID(),filter=`event_key=eq.${enc(row.event_key)}`;
    const claim=await patch(db,prefix+`outbox?${filter}&status=eq.${row.status}&attempts=eq.${row.attempts}&or=(lease_until.is.null,lease_until.lt.${enc(iso)})`,{status:'processing',attempts:row.attempts+1,lease_id:lease,lease_until:new Date(now+120000).toISOString()});
    if(!claim.length)continue;
    const owned=prefix+`outbox?${filter}&lease_id=eq.${lease}`;
    const finish=data=>patch(db,owned,{...data,lease_id:null,lease_until:null});
    try{
      const [source]=await db(prefix+`orders?order_id=eq.${enc(row.order_id)}&limit=1`);
      if(!source)throw new Error('source_missing');
      const [regs,tests]=await Promise.all([db(`mc2_registrations?token=eq.${enc(source.token)}&select=token,email,telephone,traffic_source,meta_fbc,meta_fbp&limit=1`),db(`mc2_tracking_test_registrations?token=eq.${enc(source.token)}&select=token&limit=1`)]);
      const reg=regs[0],when=Date.parse(row.event_time);
      if(!reg||tests.length||reg.traffic_source!=='meta_ad'||!Number.isFinite(when)||when<Date.parse(control.send_from)||now-when>6*86400000||when>now+60000){await finish({status:'skipped',last_error:'history_test_or_ineligible'});result.skipped++;continue;}
      if(row.attempts>=20){await finish({status:'failed',last_error:'attempt_limit'});continue;}
      // Check stop switch again immediately before any external transmission.
      const [latest]=await db(prefix+'control?id=eq.true');if(!latest?.send_enabled){await finish({status:'retry'});break;}
      const response=await send({eventName:row.event_name,eventId:row.event_id,eventTime:Math.floor(when/1000),email:reg.email,phone:reg.telephone,externalId:reg.token,fbc:reg.meta_fbc,fbp:reg.meta_fbp,value:row.amount_minor/100,currency:row.currency,url:'https://sonnycourt.com/masterclass/success/',contentName:'Esprit Subconscient 2.0 — Spiffy confirmed'});
      if(!response?.ok||Number(response.response?.events_received)!==1)throw new Error('meta_not_acknowledged');
      await finish({status:'sent',sent_at:new Date().toISOString(),last_error:null});result.sent++;
    }catch{
      await finish({status:'retry',next_attempt_at:new Date(now+Math.min(21600000,60000*2**Math.min(row.attempts,8))).toISOString(),last_error:'delivery_not_confirmed'});result.retry++;
    }
  }
  return result;
}
