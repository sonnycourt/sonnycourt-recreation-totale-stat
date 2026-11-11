import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { makeLogin } from '../netlify/functions/marketing-login.js';
import logout from '../netlify/functions/marketing-logout.js';
import { SESSION_COOKIE,SESSION_SECONDS,signMarketingSession,verifyMarketingSession,getMarketingSession,marketingSessionCookie } from '../netlify/functions/lib/marketing-auth.mjs';
import { reserveAttempt,WINDOW_MS,guardedBlobsFetch } from '../netlify/functions/lib/marketing-auth-rate-limit.mjs';
import { getSessionFromRequest } from '../netlify/functions/lib/admin-es2-verify-cookie.mjs';
import { getAdminEs2CookieSecret } from '../netlify/functions/lib/admin-es2-session-secret.mjs';
import { signSessionToken } from '../netlify/functions/lib/admin-es2-crypto.mjs';

process.env.SUPABASE_SERVICE_ROLE_KEY='auth-fixture-only';
const hash=await bcrypt.hash('fixture-password',4),readAuth=async()=>({ok:true,row:{password_hash:hash}});
const origin='https://sonnycourt.com';
const request=(password,headers={})=>new Request(origin+'/.netlify/functions/marketing-login',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify({password})});
function memoryStore(){
  const values=new Map();let revision=0;
  return {
    async getWithMetadata(id){await Promise.resolve();const row=values.get(id);return row?structuredClone(row):null;},
    async setJSON(id,data,conditions){
      await Promise.resolve();const current=values.get(id);
      if(conditions.onlyIfNew&&current || conditions.onlyIfMatch&&current?.etag!==conditions.onlyIfMatch)return {modified:false};
      const etag=String(++revision);values.set(id,{data,etag});return {modified:true,etag};
    },values
  };
}
let now=Date.now(),verified=0;
const store=memoryStore();
const reserve=({ip})=>reserveAttempt({ip,store,now});
const login=makeLogin({readAuth,reserve,compare:async(...args)=>{verified++;return bcrypt.compare(...args);}});
const context={ip:'192.0.2.1'};
// Same trusted IP, twenty forged forwarding headers: exactly three checks, even concurrently.
const concurrent=await Promise.all(Array.from({length:20},(_,i)=>login(request('wrong',{'x-forwarded-for':'198.51.100.'+i}),context)));
assert.equal(concurrent.filter(r=>r.status===401).length,3);
assert.equal(concurrent.filter(r=>r.status===429).length,17);
assert.equal(verified,3);
assert.ok(store.values.size===1 && /^[a-f0-9]{64}$/.test([...store.values.keys()][0]));
assert.ok(!JSON.stringify([...store.values]).includes(context.ip));
assert.equal((await login(request('fixture-password'),context)).status,429,'Even a correct password cannot skip the limit');
now+=WINDOW_MS-1;
assert.equal((await login(request('fixture-password'),context)).status,429);
now+=2;
const success=await login(request('fixture-password'),context);
assert.equal(success.status,200);
const cookie=success.headers.get('set-cookie');
for(const flag of ['Max-Age=2592000','HttpOnly','Secure','SameSite=Strict','Path=/'])assert.ok(cookie.includes(flag));
assert.ok(!cookie.includes('fixture-password'));
const token=cookie.split(';')[0].slice(SESSION_COOKIE.length+1);
const session=verifyMarketingSession(token,hash);
assert.ok(session);
assert.equal(verifyMarketingSession(token,hash,session.iat+SESSION_SECONDS*1000),null,'Expiry is fixed at 30 days');
assert.equal(verifyMarketingSession(token+'0',hash),null);
assert.equal(verifyMarketingSession(token,hash+'changed'),null,'Changing the password invalidates remembered sessions');
const req=new Request(origin,{headers:{cookie}});
assert.ok(await getMarketingSession(req,readAuth));
assert.equal(getSessionFromRequest(req),null,'Link Studio session cannot access the cockpit');
const oldCookie='admin_es2_session='+signSessionToken(getAdminEs2CookieSecret(),60000);
assert.equal(await getMarketingSession(new Request(origin,{headers:{cookie:oldCookie}}),readAuth),null);
assert.equal(await getMarketingSession(new Request(origin,{headers:{cookie:SESSION_COOKIE+'=%broken'}}),readAuth),null);
const unavailable=makeLogin({readAuth,reserve:()=>{throw Error('offline');},compare:()=>{throw Error('must not check');}});
assert.equal((await unavailable(request('fixture-password'),context)).status,503,'Limiter outage fails closed');
assert.equal((await login(request('fixture-password'),{})).status,503,'Missing trusted IP fails closed');
assert.equal((await login(request('fixture-password',{origin:'https://evil.invalid'}),context)).status,403);
assert.equal((await login(request(''),context)).status,400);
assert.equal((await logout(request(''))).headers.get('set-cookie'),marketingSessionCookie());
assert.equal((await logout(request('',{origin:'https://evil.invalid'}))).status,403);
// Rolling window, not a reset on the clock hour.
const staggered=memoryStore(),ip='192.0.2.2';
for(const time of [1000000,1300000,1600000])assert.ok((await reserveAttempt({ip,store:staggered,now:time})).allowed);
assert.equal((await reserveAttempt({ip,store:staggered,now:4599999})).allowed,false);
assert.equal((await reserveAttempt({ip,store:staggered,now:4600000})).allowed,true);
assert.equal((await reserveAttempt({ip,store:staggered,now:4600001})).allowed,false);
const savedFetch=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response(null,{status:409});
  assert.equal((await guardedBlobsFetch('https://test.invalid',{method:'PUT'})).status,412);
  for(const status of [400,401,403,500,502,503]){
    globalThis.fetch=async()=>new Response(null,{status});
    await assert.rejects(()=>guardedBlobsFetch('https://test.invalid',{method:'PUT'}));
  }
  globalThis.fetch=async()=>new Response(null,{status:404});
  await assert.rejects(()=>guardedBlobsFetch('https://test.invalid',{method:'PUT'}));
  assert.equal((await guardedBlobsFetch('https://test.invalid',{method:'GET'})).status,404);
}finally{globalThis.fetch=savedFetch;}
console.log('PASS — 30 jours, cookie isolé, révocation par mot de passe, CSRF, 3 tentatives/heure glissante, concurrence, IP fiable et panne fermée.');
