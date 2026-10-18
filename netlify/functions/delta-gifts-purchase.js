import {constantEqual,giftJson,giftRpc,parseGiftPurchase} from './lib/delta-gifts.mjs';

// Only the dedicated native Spiffy Purchase automation may create paid gift credits.
export default async function handler(req,context,options={}){
  const env=options.env || process.env,db={env,...(options.fetcher?{fetcher:options.fetcher}:{})};
  if(req.method!=='POST')return giftJson(405,{ok:false});
  const expected=env.DELTA_GIFTS_WEBHOOK_TOKEN || '';
  if(expected.length<48 || !constantEqual(new URL(req.url).searchParams.get('token') || '',expected))return giftJson(403,{ok:false});
  let body;try {const raw=await req.text();if(raw.length>65536)return giftJson(413,{ok:false});body=req.headers.get('content-type')?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw);}catch{return giftJson(400,{ok:false});}
  if(String(body?.checkout_id)!==env.DELTA_GIFTS_CHECKOUT_ID)return giftJson(200,{ok:true,ignored:true});
  const log=options.logger || console;
  const orderId=/^\d{1,30}$/.test(String(body?.order_id))?String(body.order_id):'invalid';
  const order=parseGiftPurchase(body,env);if(!order){
    log.warn('delta_gift_purchase_rejected',{orderId,reason:'invalid_gift_order'});
    return giftJson(422,{ok:false,error:'invalid_gift_order'});
  }
  try {await giftRpc('dv_gift_record_order',order,db);return giftJson(200,{ok:true});}catch(error){
    log.error('delta_gift_purchase_record_failed',{orderId,dbCode:/^[A-Z0-9]{5}$/.test(error.dbCode || '')?error.dbCode:'unavailable'});
    return giftJson(503,{ok:false});
  }
}
