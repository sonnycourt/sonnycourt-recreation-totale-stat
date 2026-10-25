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
assert(!source.includes('data-dv-alternative'), 'Native PayPal selection must not be hidden in the two-step popup');
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture({standard=false,total,stale=false,direct=false,badOrigin=false,preload=false}={}){
 const sent=[],timers=[],classes=new Set(),listeners={},dispatched=[];let guarantee=false;
 class Input{constructor(value){this._value=value;}get value(){return this._value;}set value(v){this._value=v;}dispatchEvent(){}closest(){return {setAttribute(){}};}}
 const base=standard?372355:371921,price=standard?147:97;
 const label={textContent:'Credit Card'},button={childNodes:[{nodeType:3,textContent:'Accéder à Delta Vision'}],parentNode:{appendChild(){guarantee=true;}}};
 const fields={['inputText-'+base]:new Input(stale?'Previous':'Alex'),['contactInfo-'+(base-1)+'-email']:new Input(stale?'old@example.com':'qa@example.com'),['inputTel-'+(base+1)]:new Input(''),['option-'+(base+3)+'-0']:{checked:false},['checkoutButton-'+(base+4)]:button,['paymentInfo-'+(base+2)]:{querySelector:()=>label,querySelectorAll:()=>[]}};
 const root={querySelector:()=>guarantee?{}:null,querySelectorAll:()=>[{textContent:'€'+(total??price)}],getBoundingClientRect:()=>({bottom:350})};
 const parent={postMessage:m=>sent.push(m)},window={parent,scrollY:0,addEventListener:(n,fn)=>listeners[n]=fn};if(direct)window.parent=window;
 const context={URLSearchParams,HTMLInputElement:Input,Event:class{},location:{pathname:standard?'/checkout/delta-vision-standard':'/checkout/delta-vision-1',search:`?dv_embed=2&dv_parent_origin=${badOrigin?'https://evil.test':'https://sonnycourt.com'}&name_first=Alex&email=qa%40example.com`},window,document:{documentElement:{classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)}},querySelector:()=>root,getElementById:id=>fields[id],createElement:()=>({setAttribute(){}})},setTimeout:fn=>timers.push(fn),MutationObserver:class{observe(){}}};
 context.document.addEventListener=(n,fn)=>listeners[n]=fn;context.document.dispatchEvent=e=>dispatched.push(e);context.CustomEvent=class{constructor(type,opts){this.type=type;this.detail=opts.detail;}};
 if(preload){context.location.search='?dv_embed=2&dv_preload=1&dv_parent_origin=https://sonnycourt.com';fields['inputText-'+base].value='';fields['contactInfo-'+(base-1)+'-email'].value='';}
 const flush=()=>{for(let i=0;timers.length&&i<170;i++)timers.shift()();};
 runInNewContext(script,context);flush();
 return {sent,classes,fields,button,listeners,dispatched,parent,flush};
}
for(const standard of [false,true])for(const stale of [false,true]){const f=fixture({standard,stale});assert(f.sent.some(x=>x.type==='dv:payment-ready'&&x.price===(standard?147:97)));assert(f.classes.has('dv-two-step-ready'));assert(f.button.childNodes[0].textContent.includes(String(standard?147:97)));}
for(const options of [{total:197},{direct:true},{badOrigin:true}])assert(!fixture(options).sent.some(x=>x.type==='dv:payment-ready'));
assert(!script.includes('fetch('));assert(!source.includes('.checked='));
for(const standard of [false,true]){
 const f=fixture({standard,preload:true}),price=standard?147:97,base=standard?372355:371921;
 assert(f.sent.some(m=>m.type==='dv:payment-warm'&&m.price===price));assert(!f.sent.some(m=>m.type==='dv:payment-ready'));assert.equal(f.fields['contactInfo-'+(base-1)+'-email'].value,'');assert.equal(f.dispatched.length,0);
 const event={origin:'https://sonnycourt.com',source:f.parent,data:{type:'dv:payment-identity',version:2,...identity}};
 f.listeners.message({...event,origin:'https://evil.test'});f.listeners.message({...event,source:{}});f.listeners.message({...event,data:{...event.data,email:'invalid'}});assert.equal(f.fields['contactInfo-'+(base-1)+'-email'].value,'');
 f.listeners.message(event);f.flush();assert.equal(f.fields['contactInfo-'+(base-1)+'-email'].value,identity.email);assert(f.sent.some(m=>m.type==='dv:payment-ready'));assert.equal(f.dispatched.length,1);
 f.listeners.message({...event,data:{...event.data,email:'other@example.com'}});assert.equal(f.fields['contactInfo-'+(base-1)+'-email'].value,identity.email);
}
const anonymous=new URL(paymentUrl(null,{price:97,checkoutUrl:inspira.checkoutUrl},'https://sonnycourt.com/delta-vision/','12345678-1234-4123-8123-123456789012'));
assert.equal(anonymous.searchParams.get('dv_preload'),'1');for(const key of ['name_first','email','dv_visit'])assert(!anonymous.searchParams.has(key));
const component=readFileSync(new URL('../src/components/delta/TwoStepCheckout.astro',import.meta.url),'utf8');
assert(component.includes('data-dvp-payment-slot'));assert(!component.includes('data-dvp-pay>'));assert(!component.includes('data-dv-price'));assert(!component.includes('data-dv-urgency'));
for (const text of ['Entre ton prénom ', 'et ton email.', 'Je me lance', 'Tes infos restent confidentielles.', 'UNE RESPIRATION. UN NOUVEL HORIZON.']) assert(component.includes(text), text);
for (const text of ['data-dvp-step=', 'Commençons', 'Aucun paiement à cette étape.', 'PAIEMENT SÉCURISÉ PAR SPIFFY', 'AUCUNE CARTE STOCKÉE SUR CE SITE', 'La leçon pour comprendre.', 'La séance guidée de 12 minutes pour vivre l’expérience.']) assert(!component.includes(text), text);
console.log('PASS: 97/147 native amount checks, identity synchronisation, direct checkout isolation, trusted messages, return URL, no card access or submission.');
