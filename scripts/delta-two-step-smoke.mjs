import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {paymentUrl,paymentMessage} from '../src/lib/delta-two-step-checkout.mjs';
import {inspira} from '../src/data/inspira.mjs';
const identity={firstName:'Alex',email:'qa@example.com'};
for(const price of [97,147]){
 const offer={price,checkoutUrl:price===97?inspira.checkoutUrl:inspira.standardCheckoutUrl};
 const u=new URL(paymentUrl(identity,offer,'https://sonnycourt.com/delta-vision/'));
 assert.equal(u.searchParams.get('dv_embed'),'2');assert.equal(u.searchParams.get('email'),identity.email);assert(!u.searchParams.has('price'));assert(!u.searchParams.has('phone_number'));
 const frame={contentWindow:{}},event={origin:u.origin,source:frame.contentWindow,data:{type:'dv:payment-ready',version:2,price,identityReady:true}};
 assert.deepEqual(paymentMessage(event,frame,price),{ready:true});
 assert.deepEqual(paymentMessage({...event,data:{...event.data,price:197}},frame,price),{error:true});
 assert.equal(paymentMessage({...event,origin:'https://evil.test'},frame,price),null);
 assert.equal(paymentMessage({...event,source:{}},frame,price),null);
 assert.equal(paymentMessage({...event,data:{event:'redirect',url:'https://evil.test'}},frame,price),null);
 assert.deepEqual(paymentMessage({...event,data:{event:'redirect',url:'https://sonnycourt.com/delta-vision/merci/'}},frame,price),{redirect:'https://sonnycourt.com/delta-vision/merci/'});
}
const source=readFileSync(new URL('../spiffy/delta-vision-two-step-embed.html',import.meta.url),'utf8');
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture({standard=false,total,stale=false,direct=false,badOrigin=false}={}){
 const sent=[],timers=[],classes=new Set();let guarantee=false;
 class Input{constructor(value){this._value=value;}get value(){return this._value;}set value(v){this._value=v;}dispatchEvent(){}closest(){return {setAttribute(){}};}}
 const base=standard?372355:371921,price=standard?147:97;
 const label={textContent:'Credit Card'},button={childNodes:[{nodeType:3,textContent:'Accéder à Delta Vision'}],parentNode:{appendChild(){guarantee=true;}}};
 const fields={['inputText-'+base]:new Input(stale?'Previous':'Alex'),['contactInfo-'+(base-1)+'-email']:new Input(stale?'old@example.com':'qa@example.com'),['inputTel-'+(base+1)]:new Input(''),['option-'+(base+3)+'-0']:{checked:false},['checkoutButton-'+(base+4)]:button,['paymentInfo-'+(base+2)]:{querySelector:()=>label,querySelectorAll:()=>[]}};
 const root={querySelector:()=>guarantee?{}:null,querySelectorAll:()=>[{textContent:'€'+(total??price)}],getBoundingClientRect:()=>({bottom:350})};
 const parent={postMessage:m=>sent.push(m)},window={parent,scrollY:0};if(direct)window.parent=window;
 const context={URLSearchParams,HTMLInputElement:Input,Event:class{},location:{pathname:standard?'/checkout/delta-vision-standard':'/checkout/delta-vision-1',search:`?dv_embed=2&dv_parent_origin=${badOrigin?'https://evil.test':'https://sonnycourt.com'}&name_first=Alex&email=qa%40example.com`},window,document:{documentElement:{classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}},querySelector:()=>root,getElementById:id=>fields[id],createElement:()=>({setAttribute(){}})},setTimeout:fn=>timers.push(fn),MutationObserver:class{observe(){}}};
 runInNewContext(script,context);for(let i=0;timers.length&&i<170;i++)timers.shift()();
 return {sent,classes,fields,button};
}
for(const standard of [false,true])for(const stale of [false,true]){const f=fixture({standard,stale});assert(f.sent.some(x=>x.type==='dv:payment-ready'&&x.price===(standard?147:97)));assert(f.classes.has('dv-two-step-ready'));assert(f.button.childNodes[0].textContent.includes(String(standard?147:97)));}
for(const options of [{total:197},{direct:true},{badOrigin:true}])assert(!fixture(options).sent.some(x=>x.type==='dv:payment-ready'));
assert(!source.includes('fetch('));assert(!source.includes('.checked='));
const component=readFileSync(new URL('../src/components/delta/TwoStepCheckout.astro',import.meta.url),'utf8');
assert(component.includes('data-dvp-payment-slot'));assert(!component.includes('data-dvp-pay>'));assert(!component.includes('data-dv-price'));assert(!component.includes('data-dv-urgency'));
console.log('PASS: 97/147 native amount checks, identity synchronisation, direct checkout isolation, trusted messages, return URL, no card access or submission.');
