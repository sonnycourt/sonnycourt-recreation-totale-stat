import {createHmac,createHash,timingSafeEqual} from 'node:crypto';

export const GIFT_PACKS = Object.freeze({1:2700,3:5100});
// Keep delayed/replayed purchases at the previous prices fulfillable.
const GIFT_PURCHASE_AMOUNTS = Object.freeze({2700:1,5100:3,4700:1,8100:3,8500:5});
export const GIFT_SITE = 'https://sonnycourt.com';
export const emailValue = value => String(value || '').trim().toLowerCase();
export const validEmail = value => value.length<=254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
export const validName = value => typeof value==='string' && value.trim().length>0 && value.trim().length<=100 && !/[<>\x00-\x1f]/.test(value);
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value));
export function constantEqual(a,b){return typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function giftReady(env=process.env){
  return env.DELTA_GIFTS_ENABLED==='true' && env.DELTA_GIFTS_EMAILS_APPROVED==='true' && env.DELTA_GIFTS_CIRCLE_APPROVED==='true'
    && !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY && (env.DELTA_GIFTS_SIGNING_KEY || '').length>=48
    && (env.DELTA_GIFTS_WEBHOOK_TOKEN || '').length>=48 && /^\d+$/.test(env.DELTA_GIFTS_CHECKOUT_ID || '')
    && ['major','minor'].includes(env.DELTA_GIFTS_AMOUNT_UNIT)
    && !!env.MAILERSEND_API_KEY && !!env.DELTA_GIFTS_EMAIL_FROM && !!env.CIRCLE_ADMIN_API_TOKEN
    && /^\d+$/.test(env.DELTA_GIFTS_CIRCLE_GROUP_ID || '') && giftSpaceIds(env).length>0 && !!circleAccessUrl(env);
}
export function giftSpaceIds(env=process.env){
  const value=String(env.DELTA_GIFTS_CIRCLE_SPACE_IDS || '');
  return /^\d+(,\d+)*$/.test(value) ? [...new Set(value.split(',').map(Number))].filter(id=>Number.isSafeInteger(id) && id>0) : [];
}
export function circleAccessUrl(env=process.env){
  try {const url=new URL(env.DELTA_GIFTS_ACCESS_URL);const host=String(env.CIRCLE_COMMUNITY_HOST || '').replace(/^https?:\/\//,'').replace(/\/$/,'');
    return url.protocol==='https:' && url.host===host && !url.username && !url.password ? url.href : null;
  } catch{return null;}
}
export function signGiftToken(purpose,id,{env=process.env,now=Date.now()}={}){
  if (!['owner','gift'].includes(purpose) || !uuid(id) || (env.DELTA_GIFTS_SIGNING_KEY || '').length<48) throw new Error('gift_token_config');
  const data=Buffer.from(JSON.stringify({v:1,p:purpose,id,exp:Math.floor(now/1000)+(purpose==='owner'?30:365)*86400})).toString('base64url');
  return `${data}.${createHmac('sha256',env.DELTA_GIFTS_SIGNING_KEY).update(data).digest('base64url')}`;
}
export function verifyGiftToken(token,purpose,{env=process.env,now=Date.now()}={}){
  if (typeof token!=='string' || token.length>600 || (env.DELTA_GIFTS_SIGNING_KEY || '').length<48) return null;
  const [data,sig,extra]=token.split('.');if(!data || !sig || extra)return null;
  const expected=createHmac('sha256',env.DELTA_GIFTS_SIGNING_KEY).update(data).digest('base64url');if(!constantEqual(sig,expected))return null;
  try {const body=JSON.parse(Buffer.from(data,'base64url').toString());return body.v===1 && body.p===purpose && uuid(body.id) && Number.isInteger(body.exp) && body.exp>Math.floor(now/1000) ? body.id : null;}catch{return null;}
}
export async function giftDb(path,{method='GET',body,env=process.env,fetcher=fetch,prefer='return=representation'}={}){
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('gift_database_config');
  const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:prefer},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Object.assign(new Error(`gift_database_${response.status}`),{status:response.status,dbCode:data?.code,reason:data?.message});
  return data;
}
export const giftRpc=(name,body,options={})=>giftDb(`rpc/${name}`,{...options,method:'POST',body});
export async function giftOrder(id,options={}){return (await giftDb(`dv_gift_orders?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,options))?.[0] || null;}
export async function giftRecord(id,options={}){return (await giftDb(`dv_gifts?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,options))?.[0] || null;}
export async function queueGiftEmail(kind,orderId,giftId,key,options={}){
  return giftDb('dv_gift_jobs?on_conflict=job_key',{...options,method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{kind,order_id:orderId,gift_id:giftId || null,job_key:key}});
}
export function parseGiftPurchase(body,env=process.env){
  if (String(body?.checkout_id)!==env.DELTA_GIFTS_CHECKOUT_ID || !/^\d+$/.test(String(body?.order_id || '')))return null;
  const email=emailValue(body.email),firstName=String(body.name_first || '').trim();
  // Dedicated checkout: no discounts, quantity, subscription, upsell or tax additions.
  // Set the unit only after inspecting this checkout's authenticated test payload.
  const amount=String(body.order_total ?? '').trim();
  const minor=env.DELTA_GIFTS_AMOUNT_UNIT==='minor';
  if(!['major','minor'].includes(env.DELTA_GIFTS_AMOUNT_UNIT) || !(minor?/^\d+$/:/^\d+(\.0{1,2})?$/).test(amount) || String(body.currency || '').toUpperCase()!=='EUR' || !validEmail(email))return null;
  if(body.subscription_id || body.payment_plan_id || ![undefined,null,'',0,'0',false,'false'].includes(body.has_order_bump))return null;
  const cents=Math.round(Number(amount)*(minor?1:100)),pack=GIFT_PURCHASE_AMOUNTS[cents];
  if(!Number.isSafeInteger(cents) || !pack)return null;
  return {p_spiffy_order:String(body.order_id),p_email:email,p_name:firstName.slice(0,100),p_pack:pack,p_amount:cents};
}
export function giftJson(status,body){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}

const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function giftEmailContent(kind,order,gift,{env=process.env,now=Date.now()}={}){
  let subject,lines,url,label;
  if(kind==='owner_email'){
    subject='Tes cadeaux Delta Vision sont prêts';
    lines=[`Bonjour${order.buyer_name ? ` ${order.buyer_name}` : ''},`,`Merci pour ton achat. Tu disposes de ${order.pack_count} ${order.pack_count===1?'cadeau Delta Vision':'cadeaux Delta Vision'} à offrir.`, 'Choisis les personnes à qui tu veux faire découvrir cette expérience. Tu peux renseigner leurs emails maintenant ou revenir plus tard.'];
    url=`${GIFT_SITE}/delta-vision-cadeaux/#owner=${signGiftToken('owner',order.id,{env,now})}`;label='Distribuer mes cadeaux';
  }else if(kind==='gift_email' && gift){
    subject='Une expérience Delta Vision t’a été offerte';
    lines=['Bonjour,',`${order.buyer_name || 'Un proche'} t’offre Delta Vision : une leçon pour découvrir la méthode et une vidéo guidée de 12 minutes pour vivre l’expérience.`, 'Clique ci-dessous, puis renseigne ton prénom et l’adresse email qui a reçu ce message pour activer ton cadeau. Ton accès est déjà payé : aucune carte bancaire ne te sera demandée.'];
    url=`${GIFT_SITE}/delta-vision-cadeau-recu/#gift=${signGiftToken('gift',gift.id,{env,now})}`;label='Activer mon cadeau';
  }else throw new Error('gift_email_kind');
  const ending=['À très vite,','Sonny',kind==='owner_email'?'Ce lien est personnel. Si tu n’es pas à l’origine de cet achat, tu peux ignorer cet email.':'Ce lien est personnel. Si ce cadeau ne te concerne pas, tu peux ignorer cet email.'];
  return {subject,text:[...lines,'',`${label} : ${url}`,'',...ending].join('\n\n'),html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#292923;line-height:1.7">${lines.map(p=>`<p>${escapeHtml(p)}</p>`).join('')}<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;background:#b34f39;color:white;text-decoration:none;border-radius:8px">${label}</a></p>${ending.map(p=>`<p>${escapeHtml(p)}</p>`).join('')}</div>`};
}
