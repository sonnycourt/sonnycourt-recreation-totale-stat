import {giftDb,signGiftToken,signGiftBuyerToken,GIFT_SITE} from './delta-gifts.mjs';

export function giftMailerLiteChannel(job,env=process.env){
  const owner=job.kind==='owner_email';
  const recovery=/^(recover|verify):/.test(job.job_key || '');
  const key=`DELTA_GIFTS_ML_${owner?'OWNER':'RECIPIENT'}${recovery?'_RECOVERY':''}`;
  return {key,owner,recovery,group:env[key+'_GROUP'],automation:env[key+'_AUTOMATION'],prefix:owner?(recovery?'recover:':'owner:'):(recovery?'verify:':'invitation:')};
}
export function giftMailerLiteEnabled(env=process.env){
  return env.DELTA_GIFTS_MAILERLITE_EMAILS_ENABLED==='true' && !!env.MAILERLITE_API_KEY;
}
export async function handoffGiftEmail(job,order,gift,{env=process.env,fetcher=fetch,now=Date.now()}={}){
  const channel=giftMailerLiteChannel(job,env),db={env,fetcher};
  if(!giftMailerLiteEnabled(env) || !/^\d+$/.test(channel.group || '') || !/^\d+$/.test(channel.automation || ''))throw new Error('gift_mailerlite_config');
  const api=async(path,method='GET',body)=>{
    const r=await fetcher(`https://connect.mailerlite.com/api${path}`,{method,headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    if(r.status===404 && method==='GET')return null;
    const data=await r.json().catch(()=>null);if(!r.ok)throw new Error(`gift_mailerlite_${r.status}`);return data?.data;
  };
  // Never mark an email handed off to a paused, incomplete or wrong workflow.
  const flow=await api(`/automations/${channel.automation}`);
  if(!flow?.enabled || flow.broken || flow.complete!==true || flow.trigger_data?.repeatable!==true || !flow.triggers?.some(t=>t.type==='subscriber_joins_group' && t.group_ids?.map(String).includes(channel.group)) || !flow.steps?.some(s=>s.type==='email' && s.complete))throw new Error('gift_mailerlite_automation_inactive');
  const email=channel.owner?order.buyer_email:gift.recipient_email;
  let orderIds=[order.id];
  if(channel.owner)orderIds=(await giftDb(`dv_gift_orders?buyer_email=eq.${encodeURIComponent(email)}&select=id`,db)).map(o=>o.id);
  const scope=channel.owner?`order_id=in.(${orderIds.join(',')})`:`gift_id=eq.${gift.id}`;
  const recent=await giftDb(`dv_gift_jobs?${scope}&kind=eq.${job.kind}&job_key=like.${encodeURIComponent(channel.prefix+'*')}&state=eq.done&completed_at=not.is.null&select=completed_at&order=completed_at.desc&limit=1`,db);
  const last=Date.parse(recent?.[0]?.completed_at || '');
  // MailerLite allows one entry per subscriber per workflow per 24 hours.
  // Defer instead of falsely claiming another message was sent.
  if(Number.isFinite(last) && last+86460000>now)return {deferUntil:new Date(last+86460000).toISOString()};
  const fields=channel.owner?{
    dv_gift_owner_url:`${GIFT_SITE}/delta-vision-cadeaux/#owner=${signGiftBuyerToken(email,{env,now})}`,
  }:{
    dv_gift_recipient_url:`${GIFT_SITE}/delta-vision-cadeau-recu/#gift=${signGiftToken('gift',gift.id,{env,now})}`,
    dv_gift_buyer_name:order.buyer_name || 'Un proche',
  };
  let subscriber=await api(`/subscribers/${encodeURIComponent(email)}`);
  if(subscriber && subscriber.status!=='active')throw new Error('gift_mailerlite_inactive_subscriber');
  if(subscriber)subscriber=await api(`/subscribers/${subscriber.id}`,'PUT',{fields});
  else subscriber=await api('/subscribers','POST',{email,fields});
  if(!/^\d+$/.test(String(subscriber?.id || '')) || subscriber.status!=='active')throw new Error('gift_mailerlite_unconfirmed');
  const inGroup=subscriber.groups?.some(g=>String(g.id)===channel.group);
  // A retried ambiguous attempt must never reset a potentially delivered workflow.
  if(inGroup && job.attempts>1)throw new Error('gift_mailerlite_delivery_review');
  if(inGroup)await api(`/subscribers/${subscriber.id}/groups/${channel.group}`,'DELETE');
  await api(`/subscribers/${subscriber.id}/groups/${channel.group}`,'POST');
  return {handedOff:true}; // Accepted by MailerLite; this is not proof of inbox delivery.
}

// Activated-gift classification remains separate from email trigger groups.
export async function syncGiftRecipient(gift,{env=process.env,fetcher=fetch}={}) {
  const group=env.MAILERLITE_GROUP_DELTA_VISION_GIFTS;
  if(!group)return {enabled:false};
  if(!/^\d+$/.test(group) || !env.MAILERLITE_API_KEY)throw new Error('gift_mailerlite_config');
  const response=await fetcher('https://connect.mailerlite.com/api/subscribers',{
    method:'POST',headers:{Authorization:`Bearer ${env.MAILERLITE_API_KEY}`,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({email:gift.recipient_email,fields:{name:gift.recipient_name},groups:[group]}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok || !(await response.json()).data?.id)throw new Error('gift_mailerlite_unconfirmed');
  return {enabled:true};
}
