import {runGiftJobs} from './lib/delta-gifts-worker.mjs';
export const config={schedule:'* * * * *'};
export default async function handler(){
  try{return Response.json(await runGiftJobs());}
  catch{return Response.json({ok:false},{status:503});}
}
