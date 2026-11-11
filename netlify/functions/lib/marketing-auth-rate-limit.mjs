import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs-auth';
import { getAdminEs2CookieSecret } from './admin-es2-session-secret.mjs';

export const WINDOW_MS=3600000, MAX_ATTEMPTS=3;
// v10 treats HTTP 409/5xx as successful conditional writes. Backport the
// official #820 fix through its public fetch adapter, without changing the
// Node runtime or the SDK used by other functions on this site.
// https://github.com/netlify/primitives/pull/820
export async function guardedBlobsFetch(input,options) {
  const response=await fetch(input,{...options,signal:AbortSignal.timeout(5000)});
  if(response.status===409){void response.body?.cancel();return new Response(null,{status:412});}
  if(!response.ok && ![304,404,412].includes(response.status)) {
    void response.body?.cancel();throw new Error('limiter_storage_unavailable');
  }
  // Missing objects are normal on reads, but a failed write is never a slot.
  if(String(options?.method).toUpperCase()==='PUT' && response.status===404) {
    void response.body?.cancel();throw new Error('limiter_storage_unavailable');
  }
  return response;
}
export function authAttemptStore(options={}) {
  return getStore({name:'link-studio-auth-v1',consistency:'strong',...options,fetch:guardedBlobsFetch});
}
// Strong reads + conditional writes reserve a slot BEFORE password verification.
// Concurrent function instances cannot each spend the same remaining attempt.
export async function reserveAttempt({ip,store=authAttemptStore(),now=Date.now()}) {
  const secret=getAdminEs2CookieSecret();
  if (!ip || !secret) throw new Error('limiter_unavailable');
  const id=crypto.createHmac('sha256',secret).update('link-studio-ip|'+ip).digest('hex');
  for(let retry=0;retry<8;retry++) {
    const current=await store.getWithMetadata(id,{type:'json',consistency:'strong'});
    if(current && (!Array.isArray(current.data?.attempts) || !current.etag)) throw new Error('limiter_unavailable');
    const attempts=(current?.data.attempts||[]).filter(t=>Number.isFinite(t)&&t>now-WINDOW_MS).sort((a,b)=>a-b);
    if(attempts.length>=MAX_ATTEMPTS) return {allowed:false,remaining:0,retryAfter:Math.max(1,Math.ceil((attempts[0]+WINDOW_MS-now)/1000))};
    const result=await store.setJSON(id,{attempts:[...attempts,now]},current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
    if(result.modified) {
      if(!result.etag) throw new Error('limiter_write_unconfirmed');
      return {allowed:true,remaining:MAX_ATTEMPTS-attempts.length-1};
    }
  }
  throw new Error('limiter_busy');
}
