import {timingSafeEqual} from 'node:crypto';
import {deltaJson,saveDeltaSubscriber} from './lib/delta-vision-mailerlite.mjs';
import {sendMetaPurchase} from './lib/delta-meta-attribution.mjs';

// Dedicated to native Purchase automations of the Delta Vision checkouts.
// No browser redirect or client event can add a buyer.
export default async function handler(req) {
  if (req.method !== 'POST') return deltaJson(405,{ok:false});
  const expected=process.env.DELTA_VISION_SPIFFY_WEBHOOK_TOKEN || '';
  const provided=new URL(req.url).searchParams.get('token') || '';
  if (expected.length < 32 || Buffer.byteLength(provided)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))) return deltaJson(403,{ok:false});
  let body;
  try {
    const raw=await req.text();if(raw.length>65536)return deltaJson(413,{ok:false});
    body=req.headers.get('content-type')?.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
  } catch {return deltaJson(400,{ok:false});}
  const email=String(body?.email || '').trim().toLowerCase();
  if (!['41037','41049','41096'].includes(String(body?.checkout_id))) return deltaJson(200,{ok:true,ignored:true});
  if (!/^\d+$/.test(String(body?.order_id || '')) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length>254) return deltaJson(422,{ok:false});
  // The provider's Purchase event is authenticated above; do not log its payment/customer payload.
  try {
    await saveDeltaSubscriber({email,firstName:String(body.name_first || '').slice(0,100)}, {buyer:true});
    // Purchase Meta CAPI seulement si cet email a été mémorisé comme lead venu d'une pub Meta ; jamais bloquant.
    await sendMetaPurchase({email,orderId:String(body.order_id),checkoutId:String(body.checkout_id),rawAmount:body.total ?? body.amount ?? body.order_total});
    return deltaJson(200,{ok:true});
  } catch {return deltaJson(503,{ok:false});} // Retry remains safe: MailerLite upserts/group additions are idempotent.
}
