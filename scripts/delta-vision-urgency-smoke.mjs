import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OFFER_DURATION_MS, OFFER_KEY, rememberedDeadline, offerState, initDeltaUrgency} from '../src/lib/delta-vision-urgency.mjs';
import {inspira} from '../src/data/inspira.mjs';
const now = 1792050000000;
const memory = (local = null, cookie = null) => ({
  readLocal: () => local, readCookie: () => cookie,
  writeLocal: x => {local = x;}, writeCookie: x => {cookie = x;},
});
let storage = memory();
const end = rememberedDeadline({now,...storage});
assert.equal(end,now+OFFER_DURATION_MS);
assert.equal(rememberedDeadline({now:now+20000,...storage}),end,'Reload does not reset');
assert.equal(rememberedDeadline({now:end+1000,...storage}),end,'Expired stays expired');
assert.equal(rememberedDeadline({now,...memory(null,String(end))}),end,'Cookie restores local storage');
assert.equal(rememberedDeadline({now,...memory(String(end),null)}),end,'Local restores cookie');
assert.equal(rememberedDeadline({now,...memory(String(end),String(end-5000))}),end-5000,'Earlier tab wins');
assert.equal(rememberedDeadline({now,...memory('9999999999999999',null)}),now,'Invalid future fails closed');
const blocked = () => {throw Error('storage denied');};
assert.equal(rememberedDeadline({now,readLocal:blocked,readCookie:blocked,writeLocal:blocked,writeCookie:blocked}),now);
assert.equal(offerState(end,end-1,inspira).price,27);
assert.equal(offerState(end,end,inspira).price,47);
assert.equal(offerState(end,end+1,inspira).checkoutUrl,inspira.standardCheckoutUrl);
assert.equal(offerState(end,end+1,inspira).remaining,0);

// Small DOM fixture: every amount/link updates together; throttled tabs recheck on click.
const node = () => ({textContent:'',attrs:{},events:{},setAttribute(k,v){this.attrs[k]=v;},hasAttribute(k){return k in this.attrs;},addEventListener(k,fn){this.events[k]=fn;}});
const links = Array.from({length:6},node);links[5].attrs['aria-label']='Je commence';
const prices = Array.from({length:5},node);
const panels = Array.from({length:2},()=>({hidden:true,parts:{},querySelector(k){return this.parts[k] ||= node();}}));
const labels = [node(),node()], cards=[node(),node()];
const events = {}, store = new Map(), docEvents={};let cookie='';
const doc={documentElement:{dataset:{}},hidden:false,get cookie(){return cookie;},set cookie(x){cookie=x.split(';')[0];},querySelectorAll(s){return {'[data-dv-urgency]':panels,'[data-dv-price]':prices,'[data-dv-buy]':links,'.price-card':cards,'.price-launch':labels}[s]||[];},addEventListener(k,fn){docEvents[k]=fn;}};
const win={location:{protocol:'https:'},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},addEventListener(k,fn){events[k]=fn;},setInterval:()=>1,clearInterval:()=>{}};
const originalNow=Date.now;let clock=now;Date.now=()=>clock;
try {
 const controller=initDeltaUrgency(doc,win,inspira);
 assert.equal(store.get(OFFER_KEY),String(end));
 assert(panels.every(p=>!p.hidden));assert(prices.every(p=>p.textContent==='27'));
 assert(links.every(l=>l.href===inspira.checkoutUrl));
 clock=now+3000;events.pageshow();assert.equal(store.get(OFFER_KEY),String(end));
 clock=end;links[0].events.click();
 assert(prices.every(p=>p.textContent==='47'));assert(panels.every(p=>p.hidden));
 assert(links.every(l=>l.href===inspira.standardCheckoutUrl));assert(labels.every(l=>l.textContent==='Delta Vision'));
 assert.equal(links[5].attrs['aria-label'],'Je commence Delta Vision — 47 euros');
 clock=end+5000;events.pageshow();assert.equal(doc.documentElement.dataset.dvOffer,'standard');
 controller.destroy();
} finally {Date.now=originalNow;}
const page=readFileSync(new URL('../src/pages/delta-vision.astro',import.meta.url),'utf8');
assert.equal((page.match(/data-dv-buy href=\{checkoutUrl\}/g)||[]).length,6);
assert.equal((page.match(/data-dv-price/g)||[]).length,6); // five prices + CSS rule
assert(!page.includes('href={checkoutUrl}') || !page.match(/(?<!data-dv-buy )href=\{checkoutUrl\}/));
assert(!readFileSync(new URL('../src/components/delta/UrgencyPreview.astro',import.meta.url),'utf8').includes('import.meta.env.DEV'));
console.log('Delta urgency: persistence, expiry boundary, cookie fallback, blocked storage, all 6 CTAs, all 5 prices, bfcache and click-time recheck passed. No network calls.');
