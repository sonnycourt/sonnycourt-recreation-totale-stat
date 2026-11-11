import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { libraryInput,readLibrary } from '../netlify/functions/lib/marketing-library.mjs';
import { createLibraryPager } from '../src/lib/marketing-library-pager.mjs';
const url=new URL('https://sonnycourt.com/.netlify/functions/admin-marketing-links?view=links');
const cursor={at:'2026-11-11T12:00:00.123456+00:00',id:crypto.randomUUID()};
url.searchParams.set('before_at',cursor.at);url.searchParams.set('before_id',cursor.id);
assert.equal(libraryInput(url).p_before_at,cursor.at,'Microsecond cursor is never truncated');
for(const [key,value] of [['view','invalid'],['q','a'.repeat(201)],['channel','constructor'],['before_id','bad'],['before_at','2026-11-11']]){
  const bad=new URL(url);bad.searchParams.set(key,value);assert.throws(()=>libraryInput(bad));
}
let args;await readLibrary(url,async(path,input)=>{args={path,input};return {};});assert.equal(args.path,'rpc/marketing_library_page');
const rows=Array.from({length:2500},(_,i)=>({id:String(i),title:'Contenu '+i}));
const pager=createLibraryPager(async({query,cursor})=>{
  const matches=rows.filter(r=>r.title.includes(query)),start=cursor?Number(cursor.id):0;
  return {items:matches.slice(start,start+24),total:matches.length,next_cursor:start+24<matches.length?{id:String(start+24),at:'fixture'}:null};
});
await pager.reset();while(pager.state.cursor)await pager.next();assert.equal(pager.state.items.length,2500);
await pager.reset('2499');assert.equal(pager.state.items[0].id,'2499');assert.equal(pager.state.total,1);
let resolveOld;const races=createLibraryPager(({query})=>query==='old'?new Promise(resolve=>{resolveOld=resolve;}):Promise.resolve({items:[{id:'new'}],total:1,next_cursor:null}));
const old=races.reset('old');await races.reset('new');resolveOld({items:[{id:'old'}],total:1,next_cursor:null});await old;assert.equal(races.state.items[0].id,'new');
let fail=false;const retry=createLibraryPager(async({cursor})=>{if(fail)throw Error('offline');return {items:[{id:cursor?'2':'1'}],total:2,next_cursor:cursor?null:{id:'next',at:'fixture'}};});
await retry.reset();fail=true;await retry.next();assert.equal(retry.state.items.length,1);assert.ok(retry.state.cursor);fail=false;await retry.next();assert.equal(retry.state.items.length,2);
console.log('PASS — navigation sur 2 500 résultats, recherche globale, curseur précis, ancienne réponse ignorée et reprise après panne.');
