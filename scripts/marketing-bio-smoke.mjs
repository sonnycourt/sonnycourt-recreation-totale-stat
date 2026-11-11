import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import collector from '../netlify/functions/marketing-bio-event.js';
import report from '../netlify/functions/admin-marketing-bio.js';
import {SESSION_COOKIE,signMarketingSession} from '../netlify/functions/lib/marketing-auth.mjs';
import {initBioTracking} from '../src/lib/marketing-bio-tracking.mjs';
import {bioRates} from '../src/lib/marketing-bio-admin.mjs';
const originalFetch=globalThis.fetch;
process.env.SUPABASE_URL='https://database.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const input={id:randomUUID(),code:'e7dd5eb52276',source:'tiktok',choice:'delta',path:'/links/',visible:true};
const request=(data=input,host='sonnycourt.com',headers={})=>new Request('https://'+host+'/.netlify/functions/marketing-bio-event',{method:'POST',headers:{origin:'https://'+host,'content-type':'application/json',...headers},body:JSON.stringify(data)});
let calls=[];
try {
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return json(true);};
  assert.equal((await collector(request({...input,email:'never stored',ip:'never stored'}))).status,200);
  assert.deepEqual(JSON.parse(calls[0].options.body),{p_id:input.id,p_code:input.code,p_source:'tiktok',p_choice:'delta'});
  assert.equal((await collector(request(input,'preview.netlify.app'))).status,200);
  assert.equal((await collector(request(input,'sonnycourt.com',{'user-agent':'facebookexternalhit'}))).status,200);
  assert.equal(calls.length,1,'Preview and bots never write');
  assert.equal((await collector(request(input,'sonnycourt.com',{origin:'https://evil.invalid'}))).status,403);
  for(const changed of [{id:'invalid'},{code:'bad'},{source:'constructor'},{path:'/admin'},{visible:false},{choice:'invalid'},{choice:undefined}])assert.equal((await collector(request({...input,...changed}))).status,400);
  assert.equal((await collector(request({...input,extra:'x'.repeat(900)}))).status,413);
  assert.equal(calls.length,1,'Invalid requests never write');
  globalThis.fetch=async()=>json(false);assert.equal((await collector(request())).status,409);
  globalThis.fetch=async()=>{throw Error('private DB error');};assert.equal((await collector(request())).status,503);
  const reqReport=(days='',cookie)=>new Request('https://sonnycourt.com/.netlify/functions/admin-marketing-bio'+days,{headers:cookie?{cookie}:{}});
  calls=[];globalThis.fetch=async()=>{calls.push(1);return json({});};
  assert.equal((await report(reqReport())).status,401);assert.equal(calls.length,0,'Private report is protected before DB access');
  const hash='test-auth-hash',cookie=SESSION_COOKIE+'='+signMarketingSession(hash);
  globalThis.fetch=async(url,options)=>{
    if(String(url).includes('/admin_es2_auth?'))return json([{id:1,password_hash:hash}]);
    calls.push(JSON.parse(options.body));return json({version:1});
  };
  for(const days of [0,7,30])assert.equal((await report(reqReport('?days='+days,cookie))).status,200);
  assert.deepEqual(calls,[{p_days:0},{p_days:7},{p_days:30}]);
  assert.equal((await report(reqReport('?days=90',cookie))).status,400);
  assert.deepEqual(bioRates({visits:4,choices:3,mc2:1,delta:2}),{delta:200/3,mc2:100/3,choice:75});
  assert.deepEqual(bioRates({visits:0,choices:0}),{delta:null,mc2:null,choice:null});

  // Fake clock / DOM, no browser storage and no network.
  const setup=(search='',host='sonnycourt.com',hidden=false)=>{
    const listeners={},timers=new Map(),requests=[],beacons=[];let sequence=0;
    const doc={hidden,addEventListener:(key,fn)=>{listeners[key]=fn;}};
    const win={location:{hostname:host,pathname:'/links/',search},crypto:{randomUUID},navigator:{sendBeacon:(url,data)=>{beacons.push(data);return true;}},
      fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return json({ok:true});},
      setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(key,fn)=>{listeners[key]=fn;}};
    Object.defineProperty(win,'localStorage',{get(){throw Error('No persistent identifiers allowed');}});
    Object.defineProperty(win,'sessionStorage',{get(){throw Error('No persistent identifiers allowed');}});
    initBioTracking(doc,win);
    const click=(key,extra={})=>listeners.click?.({type:'click',button:0,isTrusted:true,target:{closest:()=>({dataset:{bioLink:key}})},preventDefault:()=>{throw Error('Never block navigation');},...extra});
    const tick=ms=>{for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
    return {doc,win,listeners,timers,requests,beacons,click,tick};
  };
  const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
  const a=setup('?sc_link=e7dd5eb52276&utm_source=tiktok');a.click('delta-vision');a.click('masterclass');await flush();
  assert.equal(a.requests.length,1,'Quick first click counts without waiting for visit timer');assert.equal(a.requests[0].choice,'delta');assert.equal(a.requests[0].code,'e7dd5eb52276');
  a.tick(1200);await flush();assert.equal(a.requests.length,1,'No second choice or redundant visit after click');
  const b=setup();b.tick(1200);await flush();assert.equal(b.requests[0].choice,null);
  b.click('masterclass');await flush();assert.equal(b.requests[1].id,b.requests[0].id,'View and choice share the same visit');
  const pending=setup();let resolveVisit;
  pending.win.fetch=async(url,options)=>{const payload=JSON.parse(options.body);pending.requests.push(payload);return payload.choice?json({ok:true}):new Promise(resolve=>{resolveVisit=resolve;});};
  pending.tick(1200);pending.click('delta-vision');await flush();
  assert.deepEqual(pending.requests.map(x=>x.choice),[null,'delta'],'Choice is not held behind slow visit request');resolveVisit(json({ok:true}));await flush();
  const h=setup('',undefined,true);h.tick(1200);h.click('masterclass');assert.equal(h.requests.length,0);h.doc.hidden=false;h.listeners.visibilitychange();h.tick(1200);await flush();assert.equal(h.requests.length,1);
  const retry=setup();retry.win.fetch=async(url,options)=>{retry.requests.push(JSON.parse(options.body));throw Error('offline');};
  retry.click('masterclass');await flush();retry.tick(1500);await flush();retry.tick(3000);await flush();retry.tick(4500);await flush();assert.equal(retry.requests.length,3);
  assert.equal(new Set(retry.requests.map(x=>x.id)).size,1);retry.listeners.pagehide();assert.equal(JSON.parse(await retry.beacons[0].text()).id,retry.requests[0].id);
  const synthetic=setup();synthetic.click('delta-vision',{isTrusted:false});assert.equal(synthetic.requests.length,0);
  for(const [search,host] of [['?safe_deploy_check=1','sonnycourt.com'],['?preview=dev','sonnycourt.com'],['','localhost'],['','preview.netlify.app']]){
    const skipped=setup(search,host);skipped.tick(1200);skipped.click('masterclass');assert.equal(skipped.requests.length,0);assert.equal(skipped.timers.size,0);
  }
  console.log('PASS — Bio tracking: private report, validation, preview isolation, immediate clicks, first choice, retries, anonymous visits and percentage denominators.');
} finally {globalThis.fetch=originalFetch;}
