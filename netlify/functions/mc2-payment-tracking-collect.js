import {collectPayments} from './lib/mc2-payment-tracking-worker.mjs';
import {scheduledJson} from './lib/scheduled-response.mjs';
export const config={schedule:'* * * * *'};
export default async (_req,runtime)=>{
  try{return scheduledJson(await collectPayments({deployContext:runtime?.deploy?.context||process.env.CONTEXT}));}
  catch{return scheduledJson({error:'payment_tracking_unavailable'},503);}
};
