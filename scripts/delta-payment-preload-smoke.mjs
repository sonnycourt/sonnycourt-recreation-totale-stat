import assert from 'node:assert/strict';
import {mountPayment,SPIFFY_ORIGIN} from '../src/lib/delta-two-step-checkout.mjs';
import {inspira} from '../src/data/inspira.mjs';
const offer={price:97,checkoutUrl:inspira.checkoutUrl};
const identity={firstName:'Sonny',email:'qa@example.com'};
function fixture(){
 const listeners=new Map(),timers=new Map(),messages=[],frames=[];let seq=0;
 const view={location:{href:'https://sonnycourt.com/delta-vision/',assign(){throw Error('unexpected redirect');}},setTimeout(fn){timers.set(++seq,fn);return seq;},clearTimeout(id){timers.delete(id);},addEventListener(n,fn){listeners.set(fn,n);},removeEventListener(n,fn){listeners.delete(fn);}};
 const doc={defaultView:view,createTextNode:text=>({text}),createElement(tag){const el={tag,dataset:{},style:{},children:[],events:{},setAttribute(k,v){this[k]=v;},addEventListener(n,fn){this.events[n]=fn;},append(...els){this.children.push(...els);},remove(){this.removed=true;}};if(tag==='iframe'){el.contentWindow={postMessage:(data,origin)=>messages.push({data,origin})};frames.push(el);}return el;}};
 const slot={ownerDocument:doc,replaceChildren(...els){this.children=els;},setAttribute(k,v){this[k]=v;}};
 const receive=(frame,data,origin=SPIFFY_ORIGIN)=>{for(const [fn,n]of listeners)if(n==='message')fn({source:frame.contentWindow,origin,data});};
 const flush=()=>{const jobs=[...timers.values()];timers.clear();for(const fn of jobs)fn();};
 return {view,slot,frames,messages,receive,flush,listeners,timers};
}
{
 const f=fixture(),p=mountPayment(f.slot,null,offer,{view:f.view}),frame=f.frames[0];
 assert.equal(new URL(frame.src).searchParams.get('email'),null);assert.equal(f.timers.size,0);assert.equal(frame.tabIndex,-1);
 f.receive(frame,{type:'dv:payment-warm',version:2,price:97});frame.events.load();assert.equal(frame.dataset.paymentPhase,'warm');assert.equal(f.messages.length,0);
 assert.equal(p.activate(identity,'visit'),true);assert.equal(f.messages.length,1);assert.deepEqual(f.messages[0].data,{type:'dv:payment-identity',version:2,...identity,visit:'visit'});assert.equal(f.messages[0].origin,SPIFFY_ORIGIN);
 f.receive(frame,{type:'dv:payment-ready',version:2,identityReady:true,price:97});f.receive(frame,{type:'dv:payment-height',version:2,height:300});assert.equal(frame.dataset.paymentPhase,'ready');assert.equal(f.frames.length,1);assert.equal(f.timers.size,0);assert.equal(p.activate(identity),false);
 p.destroy();assert.equal(f.listeners.size,0);assert.equal(f.slot.children.length,0);
}
{
 const f=fixture(),p=mountPayment(f.slot,null,offer,{view:f.view}),frame=f.frames[0];
 p.activate(identity);assert.equal(f.messages.length,0);frame.events.load();f.receive(frame,{type:'dv:payment-warm',version:2,price:97});assert.equal(f.messages.length,1);
 p.destroy();assert.equal(f.timers.size,0);
}
{
 const f=fixture(),p=mountPayment(f.slot,null,offer,{view:f.view}),frame=f.frames[0];
 frame.events.load();p.activate(identity);const fallback=[...f.timers.values()].at(-1);fallback();assert.equal(f.frames.length,2);assert.equal(new URL(f.frames[1].src).searchParams.get('email'),identity.email);p.destroy();assert.equal(f.listeners.size,0);assert.equal(f.slot.children.length,0);
}
{
 const f=fixture(),p=mountPayment(f.slot,null,offer,{view:f.view}),frame=f.frames[0];
 f.receive(frame,{type:'dv:payment-ready',version:2,identityReady:true,price:97});assert.notEqual(frame.dataset.paymentPhase,'ready');assert.equal(f.messages.length,0);p.destroy();assert.equal(p.activate(identity),false);
}
console.log('PASS: anonymous preload, no early identity, warm reuse, fast submission race, no premature reveal, legacy fallback and cleanup.');
