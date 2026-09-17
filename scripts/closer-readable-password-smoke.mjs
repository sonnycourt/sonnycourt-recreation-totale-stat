import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {PGlite} from '@electric-sql/pglite';
import {verifyCloserPassword,ROMAIN_CREDENTIAL_MARKER} from '../netlify/functions/lib/closer-password.mjs';
import login from '../netlify/functions/closer-login.js';

const oldPassword='old-local-fixture-only';
const newPassword='new-local-fixture-only-very-long';
const hash=await bcrypt.hash(oldPassword,4);
const row={id:22,email:'2romainorfila@gmail.com',password_hash:hash,active:true};
const missing=async()=>({ok:false,error:{code:'PGRST205'}});
const staged=async()=>({ok:true,data:[{closer_id:22,email:row.email,password_plaintext:newPassword,active:false}]});
const active=async()=>({ok:true,data:[{closer_id:22,email:row.email,password_plaintext:newPassword,active:true}]});
assert.equal(await verifyCloserPassword(row,oldPassword,missing),true);
assert.equal(await verifyCloserPassword(row,oldPassword,staged),true);
assert.equal(await verifyCloserPassword(row,newPassword,staged),false);
assert.equal(await verifyCloserPassword(row,newPassword,active),true);
assert.equal(await verifyCloserPassword(row,oldPassword,active),false);
assert.equal(await verifyCloserPassword({...row,password_hash:ROMAIN_CREDENTIAL_MARKER},newPassword,active),true);
assert.equal(await verifyCloserPassword(row,'wrong',active),false);
assert.equal(await verifyCloserPassword(row,'x'.repeat(257),active),false);
await assert.rejects(()=>verifyCloserPassword(row,newPassword,async()=>({ok:false,status:500})),/credentials_unavailable/);
await assert.rejects(()=>verifyCloserPassword({...row,password_hash:ROMAIN_CREDENTIAL_MARKER},newPassword,missing),/credentials_unavailable/);
await assert.rejects(()=>verifyCloserPassword({...row,password_hash:ROMAIN_CREDENTIAL_MARKER},newPassword,staged),/credentials_unavailable/);
await assert.rejects(()=>verifyCloserPassword(row,newPassword,async()=>({ok:true,data:[{closer_id:23,email:row.email,password_plaintext:newPassword,active:true}]})),/credentials_unavailable/);
assert.equal(await verifyCloserPassword({...row,id:20,email:'owner@example.test'},oldPassword,()=>{throw new Error('must not read plaintext for other accounts');}),true);
assert.equal(await verifyCloserPassword(null,newPassword),false);

// Route HTTP : jamais de secret dans le corps, cookie HttpOnly, erreur fermée.
const originalFetch=globalThis.fetch;
process.env.SUPABASE_URL='https://db.example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='local-test-key';
globalThis.fetch=async(url,options={})=>{
  if(options.method==='PATCH')return new Response('[]',{status:200});
  return new Response(JSON.stringify(String(url).includes('closer_readable_credentials')?(await active()).data:[row]),{status:200});
};
const req=(password)=>new Request('https://site.example.test/.netlify/functions/closer-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:row.email,password})});
const success=await login(req(newPassword));
assert.equal(success.status,200);assert.match(success.headers.get('set-cookie'),/HttpOnly/);
assert.equal(await success.text(),'{"ok":true}');
assert.equal((await login(req(oldPassword))).status,401);
globalThis.fetch=originalFetch;

const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema extensions;
create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
create table public.closer_access_codes(id bigint primary key,email text,password_hash text,active boolean);
insert into public.closer_access_codes values (22,'2romainorfila@gmail.com','OLD_HASH',true),(20,'owner@example.test','OTHER_HASH',true);`);
const prepare=await readFile(new URL('../sql/romain_readable_password_prepare.sql',import.meta.url),'utf8');
const activate=await readFile(new URL('../sql/romain_readable_password_activate.sql',import.meta.url),'utf8');
await db.exec(prepare);await db.exec(prepare);
assert.equal((await db.query('select count(*)::int n from public.closer_readable_credentials')).rows[0].n,1);
assert.equal((await db.query('select active from public.closer_readable_credentials')).rows[0].active,false);
assert.equal((await db.query('select password_hash from public.closer_access_codes where id=22')).rows[0].password_hash,'OLD_HASH');
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select * from public.closer_readable_credentials'),/permission denied/);await db.exec('reset role');}
await db.exec('set role service_role');
assert.equal((await db.query('select count(*)::int n from public.closer_readable_credentials')).rows[0].n,1);
await assert.rejects(()=>db.query('update public.closer_readable_credentials set active=true'),/permission denied/);
await db.exec('reset role');
await db.exec(activate);await db.exec(activate);
assert.equal((await db.query('select password_hash from public.closer_access_codes where id=22')).rows[0].password_hash,ROMAIN_CREDENTIAL_MARKER);
assert.equal((await db.query('select password_hash from public.closer_access_codes where id=20')).rows[0].password_hash,'OTHER_HASH');
assert.equal((await db.query('select active from public.closer_readable_credentials')).rows[0].active,true);
await db.close();
console.log('Identifiant Romain : préparation/activation idempotentes, autre compte inchangé, accès privé, aucun repli ancien mot de passe après activation, connexion et absence de fuite vérifiés.');
