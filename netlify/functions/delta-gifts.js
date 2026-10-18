import {giftReady,giftJson,giftDb,giftRpc,giftOrder,giftRecord,verifyGiftToken,verifyGiftBuyerToken,emailValue,validEmail,validName,hash,queueGiftEmail,circleAccessUrl} from './lib/delta-gifts.mjs';

export const config={path:'/.netlify/functions/delta-gifts',rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
export default async function handler(req,context,options={}) {
  const env=options.env || process.env, db={env,...(options.fetcher?{fetcher:options.fetcher}:{})};
  if(req.method==='GET') return giftJson(200,{enabled:giftReady(env)});
  if(req.method!=='POST')return giftJson(405,{ok:false});
  if(req.headers.get('origin')!==new URL(req.url).origin)return giftJson(403,{ok:false});
  if(!req.headers.get('content-type')?.startsWith('application/json'))return giftJson(415,{ok:false});
  let input;
  try{const raw=await req.text();if(raw.length>4096)return giftJson(413,{ok:false});input=JSON.parse(raw);}catch{return giftJson(400,{ok:false});}
  if(!input || input.website)return giftJson(400,{ok:false});
  if(!giftReady(env))return giftJson(503,{ok:false,code:'not_ready'});
  try {
    if(input.action==='owner' || input.action==='assign'){
      const buyerEmail=verifyGiftBuyerToken(input.token,{env});
      const legacyId=verifyGiftToken(input.token,'owner',{env});
      if(!buyerEmail && !legacyId)return giftJson(401,{ok:false,code:'link_invalid'});
      if(buyerEmail && input.action==='owner'){
        const orders=await giftDb(`dv_gift_orders?buyer_email=eq.${encodeURIComponent(buyerEmail)}&status=eq.paid&select=id,pack_count,created_at&order=created_at.desc`,db);
        for(const order of orders || [])order.gifts=await giftDb(`dv_gifts?order_id=eq.${order.id}&select=slot,recipient_email,recipient_name,state&order=slot.asc`,db);
        return giftJson(200,{ok:true,orders});
      }
      const id=legacyId || input.orderId;
      if(typeof id!=='string' || !/^[a-f0-9-]{36}$/i.test(id))return giftJson(400,{ok:false});
      const order=await giftOrder(id,db);
      if(!order || order.status!=='paid' || (buyerEmail && order.buyer_email!==buyerEmail))return giftJson(403,{ok:false,code:'order_unavailable'});
      if(input.action==='assign'){
        if(!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length>order.pack_count
          || input.recipients.some(r=>!Number.isInteger(r?.slot) || r.slot<1 || r.slot>order.pack_count || !validEmail(emailValue(r.email)) || ('firstName' in r && !validName(r.firstName))))return giftJson(400,{ok:false,code:'invalid_recipients'});
        await giftRpc('dv_gift_assign',{p_order:id,p_recipients:input.recipients.map(r=>({slot:r.slot,email:emailValue(r.email),...('firstName' in r?{firstName:r.firstName.trim()}:{})}))},db);
      }
      const gifts=await giftDb(`dv_gifts?order_id=eq.${id}&select=slot,recipient_email,recipient_name,state&order=slot.asc`,db);
      return giftJson(200,{ok:true,name:order.buyer_name,count:order.pack_count,gifts});
    }
    if(input.action==='recover'){
      const email=emailValue(input.email);
      if(!validEmail(email))return giftJson(400,{ok:false});
      const allowed=await giftRpc('dv_gift_throttle',{p_key:hash(`owner:${email}`),p_seconds:86460},db);
      if(allowed){
        // One personal buyer link exposes all paid purchases, without sending one email per order.
        const orders=await giftDb(`dv_gift_orders?buyer_email=eq.${encodeURIComponent(email)}&status=eq.paid&select=id&order=created_at.desc&limit=1`,db);
        const order=orders?.[0];
        if(order)await queueGiftEmail('owner_email',order.id,null,`recover:${order.id}:${Math.floor(Date.now()/600000)}`,db);
      }
      // Identical answer whether or not this purchase exists. Never expose the manager through order_id.
      return giftJson(200,{ok:true,state:'check_email'});
    }
    if(input.action==='recognize' || input.action==='status'){
      const email=emailValue(input.email);
      if(!validEmail(email) || (input.action==='recognize' && !validName(input.firstName)))return giftJson(400,{ok:false});
      const id=verifyGiftToken(input.token,'gift',{env});
      if(input.token && !id)return giftJson(401,{ok:false,code:'link_invalid'});
      if(id){
        const gift=await giftRecord(id,db),order=gift?await giftOrder(gift.order_id,db):null;
        if(!gift || gift.recipient_email!==email || order?.status!=='paid' || !['assigned','activating','active'].includes(gift.state))return giftJson(403,{ok:false,code:'gift_mismatch'});
        if(input.action==='status'){
          const jobs=gift.state==='activating'?await giftDb(`dv_gift_jobs?gift_id=eq.${id}&kind=eq.activate&state=eq.failed&select=id&limit=1`,db):[];
          return giftJson(200,{ok:true,state:jobs.length?'assistance':gift.state,...(gift.state==='active'?{url:circleAccessUrl(env)}:{})});
        }
        const state=await giftRpc('dv_gift_activate',{p_gift:id,p_email:email,p_name:input.firstName.trim()},db);
        return giftJson(200,{ok:true,state,...(state==='active'?{url:circleAccessUrl(env)}:{})});
      }
      if(input.action==='status')return giftJson(401,{ok:false});
      const gift=(await giftDb(`dv_gifts?recipient_email=eq.${encodeURIComponent(email)}&state=in.(assigned,activating,active)&select=id,order_id&limit=1`,db))?.[0];
      const order=gift?await giftOrder(gift.order_id,db):null;
      if(!gift || order?.status!=='paid')return giftJson(200,{ok:true,state:'not_gifted'});
      const allowed=await giftRpc('dv_gift_throttle',{p_key:hash(`gift:${email}`),p_seconds:86460},db);
      if(allowed)await queueGiftEmail('gift_email',gift.order_id,gift.id,`verify:${gift.id}:${Math.floor(Date.now()/600000)}`,db);
      // Email recognition skips card entry, but only the personal link authorizes access.
      return giftJson(200,{ok:true,state:'check_email'});
    }
    return giftJson(400,{ok:false});
  }catch(error){
    if(error.dbCode==='23505')return giftJson(409,{ok:false,code:'recipient_already_gifted'});
    if(error.dbCode==='P0001' || error.dbCode==='P0002')return giftJson(409,{ok:false,code:'assignment_conflict'});
    return giftJson(503,{ok:false,code:'temporarily_unavailable'});
  }
}
