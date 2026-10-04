import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs/promises';
import student from '../netlify/functions/es2-entretien.js';
import admin from '../netlify/functions/admin-es2-entretiens.js';
import worker from '../netlify/functions/es2-entretien-worker-background.js';
import {invitation,makeToken,publicSession,planCommand,digest,jobSignature} from '../netlify/functions/lib/es2-interview-domain.mjs';
import {signSessionToken} from '../netlify/functions/lib/admin-es2-crypto.mjs';
import {getAdminEs2CookieSecret} from '../netlify/functions/lib/admin-es2-session-secret.mjs';
process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-secret';process.env.ANTHROPIC_API_KEY='test-only-model';
const rows=new Map(),deliveries=[];let calls=0,providerFail=false,holdModel=null;
const clone=x=>structuredClone(x),response=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const summary={overview:'Élève fictif : stress au travail.',sections:[{title:'Situation',observations:[{text:'Stress au travail.',kind:'reported',source_ids:['u1']}]}],priority_question:'Comment avancer ?',response_angles:['Revenir sur un exemple.'],uncertainties:['Fréquence non précisée.']};
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);
 if(u.hostname==='db.test'){
  const q=u.searchParams;
  if(options.method==='POST'){const body=JSON.parse(options.body);const existing=[...rows.values()].find(r=>r.email===body.email);if(existing)return response([]);rows.set(body.id,body);return response([clone(body)]);}
  let result=[...rows.values()].filter(r=>['id','token_hash','email','version'].every(k=>!q.has(k)||String(r[k])===q.get(k).slice(3)));
  if(options.method==='PATCH'){result=result.map(r=>{const changed={...r,...JSON.parse(options.body)};rows.set(r.id,changed);return changed;});}
  return response(clone(result));
 }
 if(u.pathname.endsWith('worker-background')){deliveries.push(new Request(url,options));return new Response(null,{status:202});}
 if(u.hostname==='api.anthropic.com'){calls++;if(holdModel)await holdModel;if(providerFail)return new Response('{}',{status:503});const body=JSON.parse(options.body);return response({model:body.model,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(body.system.includes('INTERNE')?summary:{reply:'Peux-tu me raconter un exemple récent au travail ?',ready_to_finish:false})}]});}
 throw new Error('Unexpected network target');
};
const cookie='admin_es2_session='+signSessionToken(getAdminEs2CookieSecret(),60000);
const adminRequest=body=>admin(new Request('https://site.test/.netlify/functions/admin-es2-entretiens',{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
assert.equal((await admin(new Request('https://site.test/admin'))).status,401);
assert.equal((await student(new Request('https://site.test/api?email=student@example.invalid'))).status,401);
const invites=await Promise.all([adminRequest({action:'invite',email:'Student@example.invalid',firstName:'Test'}),adminRequest({action:'invite',email:' student@example.invalid '})]);
const [a,b]=await Promise.all(invites.map(r=>r.json()));assert.equal(a.url,b.url);assert.equal(rows.size,1);
const token=new URL(a.url).hash.slice(3),id=a.id;
const request=body=>new Request('https://site.test/.netlify/functions/es2-entretien',{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function command(body,status=200){const r=await student(request(body));assert.equal(r.status,status);return r.json();}
const started=await Promise.all([command({action:'start'}),command({action:'start'})]);assert.equal(rows.get(id).messages.length,1);
let state=await command();const msg={action:'message',text:'Je stresse au travail.',requestId:randomUUID(),version:state.version};
await Promise.all([command(msg),command(msg)]);assert.equal(rows.get(id).messages.filter(m=>m.role==='user').length,1);assert.equal(deliveries.length,1);
await command({...msg,text:'Changed'},409);
const jobRequest=deliveries.shift();let release;holdModel=new Promise(resolve=>release=resolve);
const generating=worker(jobRequest.clone());await new Promise(resolve=>setTimeout(resolve,0));await worker(jobRequest.clone());assert.equal(calls,1);release();await generating;holdModel=null;
assert.equal(rows.get(id).messages.length,3);await command(msg);assert.equal(calls,1);
assert.equal(publicSession({...rows.get(id),job:{...rows.get(id).job,lease_until:'2000-01-01'}}).job.retryable,false);
state=await command();await command({action:'message',text:'stale',requestId:randomUUID(),version:state.version-1},409);
const next={action:'message',text:'Je préfère ne pas parler de mon enfance.',requestId:randomUUID(),version:state.version};await command(next);providerFail=true;await worker(deliveries.shift());assert.equal(rows.get(id).job.status,'failed');
await command({action:'retry',requestId:next.requestId});providerFail=false;await worker(deliveries.shift());assert.equal(rows.get(id).messages.filter(m=>m.requestId===next.requestId).length,1);
// Fence a late worker result after a lease has expired and another worker has claimed it.
state=await command();const late={action:'message',text:'Un autre exemple.',requestId:randomUUID(),version:state.version};await command(late);holdModel=new Promise(resolve=>release=resolve);const oldWorker=worker(deliveries.shift());await new Promise(resolve=>setTimeout(resolve,0));
rows.get(id).job.lease_until='2000-01-01';await command({action:'retry',requestId:late.requestId});const newRequest=deliveries.shift();holdModel=null;await worker(newRequest);const latestVersion=rows.get(id).version;release();await oldWorker;assert.equal(rows.get(id).version,latestVersion);assert.equal(rows.get(id).messages.filter(m=>m.role==='assistant').length,4);
state=await command();const finish={action:'finish',requestId:randomUUID(),version:state.version};await command(finish);await command(finish);assert.equal(deliveries.length,1);await worker(deliveries.shift());assert.deepEqual(rows.get(id).summary,summary);
state=await command();assert(!('summary' in state));assert(!('email' in state));assert(!('token_hash' in state));assert(!JSON.stringify(state).includes('Pistes'));assert.equal(state.status,'completed');
await command({action:'start'});await command({action:'message',text:'reopen',requestId:randomUUID(),version:state.version},409);
const recovered=await (await adminRequest({action:'invite',email:'STUDENT@EXAMPLE.INVALID'})).json();assert.equal(recovered.url,a.url);assert.equal(rows.size,1);
assert.equal((await student(new Request('https://site.test/api',{headers:{Authorization:'Bearer '+token,Origin:'https://evil.test'}}))).status,403);
const oldCalls=calls;await worker(new Request('https://site.test/worker',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,jobId:randomUUID(),signature:'0'.repeat(64)})}));assert.equal(calls,oldCalls);
assert.equal((await student(new Request('https://site.test/api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'null'}))).status,400);
// Exercise actual PostgreSQL constraints, rerunnable migration and conditional UPDATE.
const pg=new PGlite();await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');const sql=await fs.readFile(new URL('../sql/es2_interviews.sql',import.meta.url),'utf8');await pg.exec(sql);await pg.exec(sql);
const fixture=invitation('unique@example.invalid','Fixture','fixture');await pg.query('INSERT INTO es2_interviews(id,email,token_hash) VALUES($1,$2,$3)',[fixture.id,fixture.email,fixture.token_hash]);await assert.rejects(pg.query('INSERT INTO es2_interviews(id,email,token_hash) VALUES($1,$2,$3)',[randomUUID(),fixture.email,digest('other')]),e=>e.code==='23505');
const updates=await Promise.all([pg.query('UPDATE es2_interviews SET version=version+1 WHERE id=$1 AND version=0 RETURNING id',[fixture.id]),pg.query('UPDATE es2_interviews SET version=version+1 WHERE id=$1 AND version=0 RETURNING id',[fixture.id])]);assert.equal(updates.reduce((n,r)=>n+r.rows.length,0),1);
await pg.exec('SET ROLE anon');await assert.rejects(pg.query('SELECT * FROM es2_interviews'),e=>e.code==='42501');await pg.close();
console.log('PASS: unique email/token; concurrent start/send; replay; lease fencing; retry; closure; private summary; auth/origin/signature; SQL constraints and RLS permissions.');
