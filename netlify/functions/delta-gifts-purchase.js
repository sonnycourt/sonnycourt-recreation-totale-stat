import {constantEqual,giftJson,giftRpc,parseGiftPurchase} from './lib/delta-gifts.mjs';

// Only the dedicated native Spiffy Purchase automation may create paid gift credits.
export default async function handler(req){
  if(req.method!=='POST')return giftJson(405,{ok:false});
  const expected=process.env.DELTA_GIFTS_WEBHOOK_TOKEN || '';
  if(expected.length<48 || !constantEqual(new URL(req.url).searchParams.get('token') || '',expected))return giftJson(403,{ok:false});
  let body;try {const raw=await req.text();if(raw.length>65536)return giftJson(413,{ok:false});body=req.headers.get('content-type')?.includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw);}catch{return giftJson(400,{ok:false});}
  if(String(body?.checkout_id)!==process.env.DELTA_GIFTS_CHECKOUT_ID)return giftJson(200,{ok:true,ignored:true});
  const order=parseGiftPurchase(body);if(!order)return giftJson(422,{ok:false,error:'invalid_gift_order'});
  try {await giftRpc('dv_gift_record_order',order);return giftJson(200,{ok:true});}catch{return giftJson(503,{ok:false});}
}
