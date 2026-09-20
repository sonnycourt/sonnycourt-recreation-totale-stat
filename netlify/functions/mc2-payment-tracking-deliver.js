import {deliverPayments} from './lib/mc2-payment-tracking-worker.mjs';
import {scheduledJson} from './lib/scheduled-response.mjs';
export const config={schedule:'*/5 * * * *'};
export default async (_req,runtime)=>{
  try{return scheduledJson(await deliverPayments({deployContext:runtime?.deploy?.context||process.env.CONTEXT}));}
  catch{return scheduledJson({error:'payment_tracking_delivery_unavailable'},503);}
};
