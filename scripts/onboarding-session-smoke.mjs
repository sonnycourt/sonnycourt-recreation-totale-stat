import assert from 'node:assert/strict';
import login from '../netlify/functions/closer-login.js';
import logout from '../netlify/functions/closer-logout.js';
import {createHandler} from '../netlify/functions/onboarding-crm.js';
import {ROMAIN_CREDENTIAL_MARKER} from '../netlify/functions/lib/closer-password.mjs';

// Tests sans réseau, mot de passe fictif et aucune donnée réelle.
process.env.SUPABASE_URL='https://db.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='onboarding-session-local-only';
const originalFetch=globalThis.fetch,originalNow=Date.now;
const started=originalNow(),day=86400000;
let active=true,checks=0;
const ok=(condition,label)=>{assert.ok(condition,label);checks++;};
const account={id:22,email:'2romainorfila@gmail.com',password_hash:ROMAIN_CREDENTIAL_MARKER,active:true};
const secret='fictional-session-fixture';
try{
  Date.now=()=>started;
  globalThis.fetch=async(url,options={})=>{
    assert.ok(String(url).startsWith('https://db.example.test/rest/v1/'));
    const data=options.method==='PATCH'?[]:String(url).includes('closer_readable_credentials')
      ?[{closer_id:22,email:account.email,password_plaintext:secret,active:true}]:active?[account]:[];
    return new Response(JSON.stringify(data),{status:200});
  };
  const connection=await login(new Request('https://sonnycourt.com/.netlify/functions/closer-login',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:account.email,password:secret}),
  }));
  ok(connection.status===200,'login accepted');
  const setCookie=connection.headers.get('set-cookie');
  ok(/Max-Age=2592000(?:;|$)/.test(setCookie),'persistent browser cookie lasts 30 days');
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/'])ok(setCookie.includes(flag),flag);
  ok(!(await connection.text()).includes(secret),'no password returned');
  const cookie=setCookie.split(';')[0];
  const authReq=(savedCookie=cookie)=>new Request('https://sonnycourt.com/.netlify/functions/closer-login',{headers:savedCookie?{cookie:savedCookie}:{}});
  ok((await (await login(authReq())).json()).authenticated,'refresh reuses cookie without password');
  Date.now=()=>started+29*day;
  ok((await (await login(authReq())).json()).authenticated,'session still accepted on day 29');
  const crm=createHandler(async(path)=>{
    if(path.startsWith('closer_access_codes'))return active?[account]:[];
    if(path.startsWith('onboarding_staff'))return [{role:'coach'}];
    if(path==='rpc/onboarding_sync_cases')return 0;
    if(path==='rpc/onboarding_list_cases')return {cases:[],total:0,counts:{all:0}};
    throw new Error('Unexpected request');
  });
  const crmReq=(savedCookie=cookie)=>new Request('https://sonnycourt.com/.netlify/functions/onboarding-crm',{headers:{'x-onboarding-client':'1',...(savedCookie?{cookie:savedCookie}:{})}});
  ok((await crm(crmReq())).status===200,'onboarding accepts stored session on day 29');
  active=false;
  ok(!(await (await login(authReq())).json()).authenticated&&(await crm(crmReq())).status===401,'disabled account loses access before 30 days');
  active=true;
  const disconnected=await logout(new Request('https://sonnycourt.com/.netlify/functions/closer-logout',{method:'POST',headers:{cookie,'x-forwarded-proto':'https'}}));
  ok(disconnected.status===200&&disconnected.headers.get('set-cookie').includes('closer_access=; Path=/; Max-Age=0'),'logout expires the same browser cookie');
  ok(!(await (await login(authReq(''))).json()).authenticated&&(await crm(crmReq(''))).status===401,'browser after logout must authenticate again');
  Date.now=()=>started+30*day+1;
  ok(!(await (await login(authReq())).json()).authenticated&&(await crm(crmReq())).status===401,'both login and onboarding reject an expired 30-day token');
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
console.log(`Connexion onboarding : ${checks} contrôles réussis (30 jours, rafraîchissement, expiration, déconnexion). Aucun réseau.`);
