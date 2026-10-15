import assert from 'node:assert/strict';
import { initDeltaVideo } from '../src/lib/delta-vision-video.mjs';
import { inspira, inspiraEmbedUrl } from '../src/data/inspira.mjs';
class Element extends EventTarget {
  dataset = {}; style = {}; attrs = new Map(); classes = new Set();
  classList = { add: name => this.classes.add(name) };
  setAttribute(k,v) { this.attrs.set(k,v); }
  removeAttribute(k) { this.attrs.delete(k); }
  remove() { this.removed = true; }
  focus() {}
}
function setup() {
  const root = new Element(), button = new Element(), poster = new Element(), stage = new Element();
  const timers = [], rafs = [], events = {};
  let frame, resolve, reject, plays = 0, appends = 0;
  const promise = new Promise((a,b) => { resolve=a; reject=b; });
  root.dataset.videoUrl = inspiraEmbedUrl(inspira.presentationVideoUrl);
  root.querySelector = selector => selector === '[data-video-play]' ? button : poster;
  root.closest = () => stage;
  root.ownerDocument = {
    createElement: () => new Element(),
    defaultView: { setTimeout(fn,ms) { const t={fn,ms}; timers.push(t); return t; }, clearTimeout(t) { if(t)t.cancelled=true; }, requestAnimationFrame(fn) { rafs.push(fn); } }
  };
  root.append = el => { frame=el; appends++; };
  initDeltaVideo(root, () => promise);
  const api = { on(name,fn) { events[name]=fn; }, play() { plays++; } };
  const click = () => button.dispatchEvent(new Event('click'));
  return { root, button, poster, stage, frame, timers, rafs, events, api, resolve, reject, click, plays:()=>plays, appends:()=>appends };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
for (const readyFirst of [true,false]) {
  const s = setup();
  assert.equal(new URL(s.frame.src).searchParams.get('autoplay'),'false');
  assert.equal(new URL(s.frame.src).searchParams.get('preload'),'true');
  assert.equal(new URL(s.frame.src).searchParams.get('t'),'0');
  assert.equal(s.appends(),1,'Iframe preloaded before click');
  assert.equal(s.frame.style.opacity,'0');
  if(readyFirst) { s.resolve(s.api); await flush(); assert.equal(s.plays(),0); }
  s.click(); s.click();
  assert(!s.poster.removed && !s.stage.classes.has('is-open'),'Poster and jungle remain stable during loading');
  if(!readyFirst) { s.resolve(s.api); await flush(); }
  assert.equal(s.plays(),1);
  s.events.play();
  s.rafs.splice(0).forEach(fn=>fn());
  assert(s.poster.removed && s.button.removed);
  assert(s.stage.classes.has('is-open'));
  assert.equal(s.frame.style.opacity,'1');
  assert.equal(s.frame.style.transition,'none');
  assert.equal(s.appends(),1,'No iframe reloading at click');
}
const fallback=setup();
fallback.reject(new Error('API unavailable')); await flush();
fallback.frame.dispatchEvent(new Event('load'));
assert(!fallback.poster.removed);
fallback.click();
assert.equal(fallback.frame.style.opacity,'1','API failure exposes native controls after click');
const denied=setup();
denied.resolve(denied.api); await flush(); denied.click();
denied.timers.find(t=>t.ms===1800).fn();
assert(denied.button.removed,'Autoplay denial cannot trap the native Play button');
console.log('PASS: preload, both click/ready orders, no playback before click, no poster flash, one player, API failure and autoplay fallback.');
