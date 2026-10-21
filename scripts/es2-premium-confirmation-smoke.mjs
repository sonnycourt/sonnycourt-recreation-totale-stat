import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/pages/es2-premium-confirmation.astro', import.meta.url), 'utf8');
const script = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const settle = () => new Promise(resolve => setImmediate(resolve));
function boot(fetcher) {
  const nodes = new Map(), timers = new Map();
  let next = 0, calls = 0;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {hidden:true,value:'',textContent:'',children:[],addEventListener(){},append(n){this.children.push(n);}});
    return nodes.get(id);
  };
  runInNewContext(script, {
    URLSearchParams, AbortController,
    location:{search:'?order=2554945&email=test%40example.com',pathname:'/es2-premium-confirmation/'},
    history:{replaceState(){}}, sessionStorage:{getItem(){return null;},setItem(){}},
    document:{getElementById:node,querySelector:node,createElement:()=>({})},
    fetch:(...args)=>{calls++;return fetcher(...args);},
    setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},
    clearTimeout:id=>timers.delete(id),
  });
  return {node,timers,calls:()=>calls};
}
const json = data => async()=>({ok:true,json:async()=>data});
const paid=boot(json({paid:true})); await settle();
assert.equal(paid.node('billing-form').hidden,false);
assert.equal(paid.node('loading-state').hidden,true);
assert.equal(paid.timers.size,0);

const rejected=boot(json({paid:false,retryable:false})); await settle();
assert.equal(rejected.calls(),1);
assert.equal(rejected.timers.size,0);
assert.equal(rejected.node('identity-form').hidden,false);
assert.match(rejected.node('loading-state').textContent,/Ne repaie pas/);

const pending=boot(json({paid:false,retryable:true})); await settle();
for(let i=0;i<5;i++) {
  const entry=[...pending.timers].find(([,t])=>t.ms===5000);
  assert(entry);pending.timers.delete(entry[0]);entry[1].fn();await settle();
}
assert.equal(pending.calls(),6);
assert.equal(pending.timers.size,0);
assert.match(pending.node('loading-state').textContent,/Ne repaie pas/);

const stalled=boot((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
const deadline=[...stalled.timers.values()].find(t=>t.ms===12000);
assert(deadline);deadline.fn();await settle();
assert.equal(stalled.node('identity-form').hidden,false);
assert.match(stalled.node('loading-state').textContent,/Ne repaie pas/);
assert.equal(stalled.timers.size,0);
let syncCalls=0;
const delayed=boot(async()=>({ok:true,json:async()=>({paid:++syncCalls===3,retryable:true})}));await settle();
for(let i=0;i<2;i++) {
  const [id,timer]=[...delayed.timers].find(([,t])=>t.ms===5000);
  delayed.timers.delete(id);timer.fn();await settle();
}
assert.equal(delayed.node('billing-form').hidden,false);
assert.equal(delayed.timers.size,0);
let outages=0;
const outage=boot(async()=>++outages===1
  ? {ok:false,status:503,json:async()=>({error:'Temporary provider outage'})}
  : {ok:true,json:async()=>({paid:true})});await settle();
const [outageId,outageTimer]=[...outage.timers].find(([,t])=>t.ms===5000);
outage.timers.delete(outageId);outageTimer.fn();await settle();
assert.equal(outage.node('billing-form').hidden,false);
assert.equal(outage.timers.size,0);
console.log('Confirmation UI: success, terminal refusal, bounded retries and network timeout passed.');
