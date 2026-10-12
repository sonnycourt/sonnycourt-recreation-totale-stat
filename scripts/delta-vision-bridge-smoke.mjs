import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../spiffy/delta-vision-payment-embed.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function fixture(staleEmail,stalePhone=false){
  const sent=[],timers=[];
  class Input {
    constructor(value){this._value=value;this.events=[];}
    get value(){return this._value;}
    set value(value){this._value=value;}
    dispatchEvent(event){this.events.push(event.type);}
    closest(){return {setAttribute(){}};}
  }
  const fields={
    'inputText-371787':new Input('Test'),
    'contactInfo-371781-email':new Input(staleEmail?'previous@example.com':'delta-qa@example.com'),
    'inputTel-371786':new Input(stalePhone?'+12025550199':'+12025550123'),
    'option-371788-0':{},
  };
  const root={querySelector(selector){return selector==='#paymentInfo-371783'?{}:null;},getBoundingClientRect(){return {bottom:400};}};
  const parent={postMessage(message){sent.push(message);}};
  const context={URLSearchParams,HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},
    location:{pathname:'/checkout/delta-vision',search:'?dv_embed=1&dv_parent_origin=https://test--sonnycourt-recreation-totale.netlify.app&name_first=Test&email=delta-qa%40example.com&phone_number=%2B12025550123'},
    window:{parent,scrollY:0},
    document:{readyState:'complete',documentElement:{classList:{add(){}}},querySelector(){return root;},getElementById(id){return fields[id]||null;}},
    setTimeout(fn){timers.push(fn);},MutationObserver:class{observe(){}},
  };
  runInNewContext(script,context);
  for(let i=0;timers.length && i<160;i++)timers.shift()();
  assert(sent.some(message=>message.type==='dv:payment-ready' && message.identityReady));
  assert.equal(fields['contactInfo-371781-email'].value,'delta-qa@example.com');
  assert.equal(fields['inputTel-371786'].value,'+12025550123');
  if(staleEmail)assert.deepEqual(fields['contactInfo-371781-email'].events,['input','change']);
}
fixture(false);fixture(true);fixture(true,true);
console.log('Spiffy bridge: fresh identity and restored-email mismatch both reach payment readiness. No external calls.');
