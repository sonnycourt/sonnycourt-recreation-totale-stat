import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateCreate, buildDestination, linkCode, shortUrl, publicationUrl, publicationDate, validatePublicationUpdate } from '../src/lib/marketing-links-contract.mjs';
import { BIO_LINKS } from '../src/lib/marketing-bio-links.mjs';
import { bioChoiceUrl } from '../src/lib/marketing-bio-attribution.mjs';
import { hasStatisticsConsent, initMarketingAttribution } from '../src/lib/marketing-attribution.mjs';
import { COOKIE, database, sign, verify, validReceipt, recordMarketingRegistration, isDestinationPath } from '../netlify/functions/lib/marketing-links.mjs';
import { SESSION_COOKIE, signMarketingSession } from '../netlify/functions/lib/marketing-auth.mjs';
import admin from '../netlify/functions/admin-marketing-links.js';
import redirect from '../netlify/functions/marketing-link-redirect.js';
import arrival from '../netlify/functions/marketing-link-arrival.js';

const originalFetch = globalThis.fetch;
const originalEnv = { url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY };
process.env.SUPABASE_URL = 'https://database.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-only';
let checks = 0;
const ok = (value, message) => { assert.ok(value,message); checks++; };
const id = crypto.randomUUID(), cId = crypto.randomUUID(), eventId = crypto.randomUUID(), visitor = crypto.randomUUID();
const input = { id, content_id:cId,title:'Les 7 affirmations',format:'short',topic:'Manifestation',angle:'Émotion',channel:'instagram',placement:'dm',campaign:'MC2 Été 2026',destination:'mc2',publication_label:'Reel du jeudi' };
const link = {...validateCreate(input),code:linkCode(id)};
const body = r => r.json();
const request = (name, data, extra = {}) => new Request(`https://sonnycourt.com/.netlify/functions/${name}`, {method:data === undefined ? 'GET' : 'POST',headers:{origin:'https://sonnycourt.com','content-type':'application/json',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
const answer = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const authHash='test-password-hash-only';
const adminCookie = SESSION_COOKIE+'='+signMarketingSession(authHash);
const withAuth=fn=>async(url,options)=>String(url).includes('/admin_es2_auth?')?answer([{id:1,password_hash:authHash}]):fn(url,options);

try {
  assert.equal(link.campaign,'mc2-ete-2026'); checks++;
  assert.equal(publicationDate('2026-11-11'),'2026-11-11');assert.equal(publicationDate(''),null);checks+=2;
  assert.throws(()=>publicationDate('2026-02-30'));assert.throws(()=>publicationUrl('javascript:alert(1)'));assert.throws(()=>publicationUrl('https://secret@example.com/'));checks+=3;
  const meta=validatePublicationUpdate({publication_id:id,published_on:'2026-11-11',publication_url:'https://www.instagram.com/reel/demo/'});
  ok(meta.publication_url==='https://www.instagram.com/reel/demo/','Optional public post URL normalized');
  const target = new URL(buildDestination(link));
  ok(target.origin === 'https://sonnycourt.com' && target.pathname === '/mc2/','Only approved destination');
  ok(target.searchParams.get('utm_content') === link.code && target.searchParams.get('sc_link') === link.code,'Stable link ID');
  ok(!target.searchParams.has('email') && !target.searchParams.has('token'),'No identity in public link');
  assert.equal(validateCreate({...input,channel:'meta_ads'}).destination,'meta_mc2'); checks++;
  for (const field of ['channel','format','placement','destination']) { assert.throws(() => validateCreate({...input,[field]:'constructor'})); checks++; }
  assert.throws(() => validateCreate({...input,destination:'https://evil.invalid'})); checks++;
  let calls = [];
  globalThis.fetch = async (url,options) => { calls.push([url,options]); return answer({}); };
  assert.equal((await admin(request('admin-marketing-links'))).status,401); checks++;
  assert.equal(calls.length,0); checks++;
  assert.equal((await admin(request('admin-marketing-links?view=links'))).status,401);checks++;
  assert.equal(calls.length,0);checks++;
  globalThis.fetch=withAuth(async(url,options)=>{
    ok(url.endsWith('/rpc/marketing_library_page'),'Library uses the private paginated RPC');
    const p=JSON.parse(options.body);assert.equal(p.p_kind,'links');assert.equal(p.p_search,'ancien');assert.equal(p.p_channel,'instagram');checks+=3;
    return answer({items:[link],total:2500,next_cursor:{at:'2026-11-11T10:00:00.123456+00:00',id}});
  });
  const libraryResponse=await body(await admin(request('admin-marketing-links?view=links&q=ancien&channel=instagram',undefined,{cookie:adminCookie})));
  ok(libraryResponse.connected&&libraryResponse.total===2500,'Authenticated library returns complete match count');
  assert.equal((await admin(request('admin-marketing-links?view=invalid',undefined,{cookie:adminCookie}))).status,400);checks++;
  assert.equal((await admin(request('admin-marketing-links',input,{cookie:adminCookie,origin:'https://evil.invalid'}))).status,403); checks++;
  assert.equal((await admin(request('admin-marketing-links',input,{cookie:'admin_es2_session=%broken'}))).status,401); checks++;
  globalThis.fetch = withAuth(async () => answer({code:'PGRST202'},404));
  assert.equal((await body(await admin(request('admin-marketing-links',undefined,{cookie:adminCookie})))).code,'schema_missing'); checks++;
  globalThis.fetch = withAuth(async (url,options) => { if(options.method==='GET')return answer([]);ok(url.endsWith('/rpc/marketing_create_link'),'Create uses one atomic RPC'); assert.equal(JSON.parse(options.body).p_input.id,id); return answer(link); });
  assert.equal((await admin(request('admin-marketing-links',input,{cookie:adminCookie}))).status,200); checks++;
  globalThis.fetch=withAuth(async(url,options)=>{ok(url.endsWith('/rpc/marketing_update_publication'),'Metadata edit only changes publication');const payload=JSON.parse(options.body);assert.equal(payload.p_id,id);return answer(meta);});
  const patchReq=new Request('https://sonnycourt.com/.netlify/functions/admin-marketing-links',{method:'PATCH',headers:{origin:'https://sonnycourt.com','content-type':'application/json',cookie:adminCookie},body:JSON.stringify(meta)});
  assert.equal((await admin(patchReq)).status,200);checks++;

  calls = []; globalThis.fetch = async (url,options) => { calls.push([url,options]); return answer([link]); };
  const redir = await redirect(new Request(`https://sonnycourt.com/.netlify/functions/marketing-link-redirect?code=${link.code}&url=https://evil.invalid&utm_source=evil&email=private`));
  assert.equal(redir.status,302); assert.equal(redir.headers.get('location'),target.href); checks+=2;
  ok(calls.length === 1 && calls[0][1].method === 'GET','Redirects never count as visits');
  const publicRedirect=await redirect(new Request(`https://sonnycourt.com/r/${link.code}?code=ffffffffffff&utm_source=evil&fbclid=Meta_click-123`));
  const publicTarget=new URL(publicRedirect.headers.get('location'));
  assert.equal(publicRedirect.status,302);checks++;
  ok(calls.at(-1)[0].includes('code=eq.'+link.code),'Netlify v2 original public pathname determines the link, never the caller query');
  ok(publicTarget.searchParams.get('utm_content')===link.code && publicTarget.searchParams.get('fbclid')==='Meta_click-123','Public short URL preserves the same attribution and click ID');
  assert.equal((await redirect(new Request(`https://sonnycourt.com/r/${link.code}/`,{method:'HEAD'}))).status,302);checks++;
  assert.equal((await redirect(new Request(`https://sonnycourt.com/r/invalid?code=${link.code}`))).status,404);checks++;
  const adRedirect = await redirect(new Request(`https://sonnycourt.com/.netlify/functions/marketing-link-redirect?code=${link.code}&fbclid=Meta_click-123&utm_source=evil&email=private`));
  const adUrl=new URL(adRedirect.headers.get('location'));
  ok(adUrl.searchParams.get('fbclid')==='Meta_click-123' && adUrl.searchParams.get('utm_source')==='instagram' && !adUrl.searchParams.has('email'),'Preserve platform click ID only, no arbitrary override');
  assert.equal((await redirect(new Request('https://sonnycourt.com/.netlify/functions/marketing-link-redirect?code=bad'))).status,404); checks++;
  for(const bio of BIO_LINKS){
    const row={...link,code:bio.code,channel:bio.channel,placement:'bio',campaign:'mc2-evergreen'};
    calls=[];
    globalThis.fetch=async(url,options)=>{calls.push([url,options]);assert.ok(String(url).includes('code=eq.'+bio.code));return answer([row]);};
    assert.equal(shortUrl(bio.code),'https://sonnycourt.com'+bio.path);checks++;
    for(const suffix of ['', '/']){
      const response=await redirect(new Request('https://sonnycourt.com'+bio.path+suffix+'?code=ffffffffffff&utm_source=evil&url=https://evil.invalid&fbclid=click-123'));
      const destination=new URL(response.headers.get('location'));
      assert.equal(response.status,302);assert.equal(destination.pathname,bio.entryPath||'/mc2/');assert.equal(destination.searchParams.get('utm_source'),bio.channel);
      assert.equal(destination.searchParams.get('utm_content'),bio.code);assert.equal(destination.searchParams.get('sc_link'),bio.code);assert.equal(destination.searchParams.get('fbclid'),'click-123');checks+=6;
    }
    const legacy=await redirect(new Request('https://sonnycourt.com/r/'+bio.code));
    assert.equal(legacy.headers.get('location'),buildDestination(row));checks++;
    for(const previousPath of bio.legacyPaths||[]){
      const previous=await redirect(new Request('https://sonnycourt.com'+previousPath));
      assert.equal(previous.status,302);assert.equal(previous.headers.get('location'),buildDestination(row));checks+=2;
    }
    ok(calls.every(([,options])=>options.method==='GET'),'Bio aliases never count redirects as arrivals');
    if(bio.entryPath){
      for(const path of ['/mc2/','/delta-vision/']){
        const choice=new URL(bioChoiceUrl(path+'?utm_content=default',new URL(buildDestination(row)).search+'&token=secret&email=private&fbclid=click-123'),target.origin);
        assert.equal(choice.pathname,path);assert.equal(choice.searchParams.get('sc_link'),bio.code);assert.equal(choice.searchParams.get('utm_content'),bio.code);assert.equal(choice.searchParams.get('utm_source'),bio.channel);checks+=4;
        ok(!choice.searchParams.has('token')&&!choice.searchParams.has('email')&&choice.searchParams.get('fbclid')==='click-123','Programme choice preserves tracking without private query parameters');
        ok(isDestinationPath('mc2',path,bio.code),'Both programme choices accept the same profile link');
      }
      ok(!isDestinationPath('mc2','/links/',bio.code)&&!isDestinationPath('mc2','/admin/',bio.code),'No double counting at the hub or arbitrary path');
    }else ok(!isDestinationPath('mc2','/delta-vision/',bio.code),'Direct MC2 links cannot claim another programme');
  }
  assert.equal((await redirect(new Request('https://sonnycourt.com/masterclass/unknown?code='+link.code))).status,404);checks++;
  assert.equal(shortUrl(link.code),'https://sonnycourt.com/r/'+link.code);checks++;
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal((await redirect(new Request(`https://sonnycourt.com/.netlify/functions/marketing-link-redirect?code=${link.code}`))).status,503); checks++;

  const receipt = sign('arrival',{event_id:eventId,code:link.code,exp:Date.now()+60000});
  ok(validReceipt(receipt),'Server receipt validates');
  ok(!validReceipt(receipt+'x') && !verify('visitor',receipt),'Tampering / purpose mismatch rejected');
  ok(!verify('arrival',receipt,Date.now()+120000),'Expiration enforced');
  const payload = {code:link.code,event_id:eventId,path:'/mc2/',visible:true,statistics_consent:false};
  calls = [];
  globalThis.fetch = async (url,options) => {
    calls.push([url,options]);
    if (options.method === 'GET') return answer([link]);
    const p = JSON.parse(options.body);
    return answer([{id:p.p_event_id,link_id:p.p_link_id,visitor_id:p.p_visitor_id}]);
  };
  const anon = await arrival(request('marketing-link-arrival',payload));
  ok(anon.status === 200 && validReceipt((await body(anon)).receipt),'Anonymous arrival receipt');
  ok(anon.headers.get('set-cookie').includes('Max-Age=0'),'No persistent cookie without consent');
  const stored = JSON.parse(calls[1][1].body);
  ok(stored.p_visitor_id === null && !('email' in stored),'No anonymous identity persisted');
  const signedVisitor = sign('visitor',{id:visitor,exp:Date.now()+60000});
  const withConsent = await arrival(request('marketing-link-arrival',{...payload,statistics_consent:true},{cookie:COOKIE+'='+signedVisitor}));
  ok(withConsent.headers.get('set-cookie').includes('HttpOnly') && withConsent.headers.get('set-cookie').includes('Secure'),'Signed secure consent cookie');
  assert.equal(JSON.parse(calls.at(-1)[1].body).p_visitor_id,visitor); checks++;
  assert.equal((await arrival(request('marketing-link-arrival',{...payload,path:'/admin/'}))).status,400); checks++;
  const before = calls.length;
  ok((await body(await arrival(request('marketing-link-arrival',payload,{'user-agent':'facebookexternalhit'})))).skipped === 'automated','Scanner skipped');
  const previewReq = new Request('https://preview.netlify.app/.netlify/functions/marketing-link-arrival',{method:'POST',headers:{origin:'https://preview.netlify.app','content-type':'application/json'},body:JSON.stringify(payload)});
  ok((await body(await arrival(previewReq))).skipped === 'preview' && calls.length===before,'Preview cannot record production arrivals');
  assert.equal((await arrival(request('marketing-link-arrival',payload,{origin:'https://evil.invalid'}))).status,403); checks++;

  globalThis.fetch = async () => { throw new Error('SQL missing'); };
  ok(await recordMarketingRegistration(request('register-mc2',{}),{token:'test'},receipt) === false,'DB failure never fails registration');
  let linked;
  globalThis.fetch = async (url,options) => { linked=JSON.parse(options.body); return answer(true); };
  ok(await recordMarketingRegistration(request('register-mc2',{}, {cookie:COOKIE+'='+signedVisitor}),{token:'test'},undefined,true),'Consented direct return uses previous touchpoints');
  ok(linked.p_visitor_id === visitor && linked.p_event_id === null,'Direct return never trusts a caller-supplied visitor ID');
  linked=null;
  ok(!await recordMarketingRegistration(request('register-mc2',{}, {cookie:COOKIE+'='+signedVisitor}),{token:'test'},undefined,false) && linked === null,'No history association after refusal');

  const doc={cookie:''},win={localStorage:{getItem:()=>null}};
  ok(!hasStatisticsConsent(doc,win),'Consent default off');
  doc.cookie='cookieConsent='+encodeURIComponent(JSON.stringify({statistics:true,timestamp:Date.now()}));
  ok(hasStatisticsConsent(doc,win),'Fresh statistics consent accepted');
  doc.cookie='cookieConsent='+encodeURIComponent(JSON.stringify({statistics:false,timestamp:Date.now()}));
  win.localStorage.getItem=()=>JSON.stringify({allowed:true,at:Date.now()});
  ok(!hasStatisticsConsent(doc,win),'Explicit refusal wins over older Delta preference');
  let madeRequest=false;
  initMarketingAttribution({}, {location:{hostname:'localhost'},fetch:()=>{madeRequest=true;}});
  ok(!madeRequest,'Local UI cannot send tracking');
  const mc2 = readFileSync(new URL('../src/pages/mc2/index.astro',import.meta.url),'utf8');
  ok(mc2.includes('marketing_receipt:') && mc2.includes('metaOptin.getPayload()'),'Additive payload preserves Meta');
  console.log(`PASS — ${checks} contrôles : autorisation, CSRF, redirections, déduplication, consentement, panne et isolement preview.`);
} finally {
  globalThis.fetch=originalFetch;
  for (const [key,value] of [['SUPABASE_URL',originalEnv.url],['SUPABASE_SERVICE_ROLE_KEY',originalEnv.key]]) { if (value===undefined) delete process.env[key]; else process.env[key]=value; }
}
