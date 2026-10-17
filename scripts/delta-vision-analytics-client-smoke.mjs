import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {initDeltaAnalytics} from '../src/lib/delta-vision-analytics.mjs';
class El extends EventTarget{dataset={};hidden=false;href='https://sonnycourt.spiffy.co/checkout/delta-vision-1';getBoundingClientRect(){return {top:0,bottom:100,width:200,height:100};}}
const buttons=Array.from({length:6},()=>new El()),yes=new El(),no=new El(),prefs=new El(),panel=new El();yes.dataset.dvConsent='yes';no.dataset.dvConsent='no';
const doc=new EventTarget();doc.documentElement={dataset:{dvOffer:'launch'},scrollHeight:4000};doc.cookie='';doc.referrer='https://www.youtube.com/watch?v=private-query';doc.hidden=false;
doc.querySelector=s=>s==='#dv-analytics-consent'?panel:s==='#dv-analytics-preferences'?prefs:null;
doc.querySelectorAll=s=>s==='[data-dv-buy]'?buttons:s==='[data-dv-consent]'?[yes,no]:[];
let clock=0;const timers=[],batches=[],storage=new Map();const win=new EventTarget();
Object.assign(win,{location:{hostname:'sonnycourt.com',search:'?utm_source=youtube'},crypto:webcrypto,performance:{now:()=>clock,getEntriesByType:()=>[]},innerHeight:800,scrollY:0,
localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},matchMedia:()=>({matches:true}),getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),setInterval:(fn,ms)=>timers.push({fn,ms}),setTimeout:()=>0,
fetch:async(url,options)=>{batches.push(JSON.parse(options.body));return {ok:true};}});
globalThis.MutationObserver=class{observe(){}};
const tracker=initDeltaAnalytics(doc,win);assert.equal(batches.length,0,'No collection before consent');assert.equal(storage.has('dv_analytics_visitor_v1'),false);
yes.dispatchEvent(new Event('click'));await new Promise(setImmediate);assert.equal(batches.length,1);assert.equal(batches[0].events[0].event_name,'visit');assert.equal(batches[0].events[0].price,97);assert.equal(batches[0].source,'youtube');assert.equal(new URL(buttons[0].href).searchParams.get('dv_visit'),batches[0].visit_id);
clock=1000;timers.find(x=>x.ms===1000).fn();clock=2000;timers.find(x=>x.ms===1000).fn();tracker.snapshot();tracker.flush();await new Promise(setImmediate);
assert.equal(batches.at(-1).events.filter(x=>x.event_name==='cta_seen').length,6);
assert.equal(batches.at(-1).events.find(x=>x.event_name==='heartbeat').metadata.active,2);
doc.hidden=true;clock=3000;timers.find(x=>x.ms===1000).fn();tracker.snapshot();tracker.flush();await new Promise(setImmediate);assert.equal(batches.at(-1).events.find(x=>x.event_name==='heartbeat').metadata.active,2,'Hidden tab not active');
doc.documentElement.dataset.dvOffer='standard';tracker.snapshot();tracker.flush();await new Promise(setImmediate);assert(batches.at(-1).events.every(e=>e.price===147));
no.dispatchEvent(new Event('click'));assert.equal(storage.has('dv_analytics_visitor_v1'),false);assert.equal(new URL(buttons[0].href).searchParams.has('dv_visit'),false);const count=batches.length;tracker.snapshot();tracker.flush();assert.equal(batches.length,count,'Revocation stops collection');
console.log('PASS: consent start/revoke, safe source, unique visit, 6 exposed CTAs, foreground time, tracking link removal. No network.');
