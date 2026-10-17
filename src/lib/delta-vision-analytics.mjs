import {DeltaWatch} from './delta-analytics-watch.mjs';
const KEY='dv_analytics_consent_v1',IDENTITY='dv_analytics_visitor_v1';
const safeLabel=(s,max=80)=>typeof s==='string'&&/^[\p{L}\p{N} ._:/-]*$/u.test(s)?s.slice(0,max):'';
export function initDeltaAnalytics(doc=document,win=window){
 if(doc.documentElement.dataset.dvAnalytics)return;doc.documentElement.dataset.dvAnalytics='ready';
 // Never pollute real reports from previews, localhost or automated screenshots.
 const production=win.location.hostname==='sonnycourt.com'||win.location.hostname==='www.sonnycourt.com';
 const read=k=>{try{return JSON.parse(win.localStorage.getItem(k));}catch{return null;}};
 const write=(k,v)=>{try{win.localStorage.setItem(k,JSON.stringify(v));}catch{}};
 const uuid=()=>win.crypto.randomUUID();
 const consent=()=>{const c=read(KEY);if(c&&Date.now()-c.at<180*86400000)return c.allowed===true;try{const c=JSON.parse(decodeURIComponent(doc.cookie.split('; ').find(x=>x.startsWith('cookieConsent='))?.slice(14)||''));if(Date.now()-c.timestamp<180*86400000)return c.statistics===true;}catch{}return null;};
 let enabled=false,context,queue=[],sending=false,active=0,maxScroll=0,lastTick=win.performance.now(),lastAction=lastTick,playing=false,requestedAt=null,firstPlay=false,watch=new DeltaWatch(),progressDirty=false;
 const sectionTimes=new Map(),seen=new Set(),visibleSince=new Map();
 const names=['hero','histoire','ressentir','garantie','closing','sticky'];
 const buttons=[...doc.querySelectorAll('[data-dv-buy]')];buttons.forEach((el,i)=>el.dataset.dvAnalyticsCta=names[i]||'sticky');
 const sections=[...doc.querySelectorAll('#presentation,#histoire,#ressentir,#methode,#science,#garantie,#tarif')];
 const price=()=>doc.documentElement.dataset.dvOffer==='standard'?147:97;
 const elapsed=()=>Math.min(86400,(Date.now()-Date.parse(context.visit_started_at))/1000);
 const emit=(event_name,metadata={})=>{if(!enabled)return;queue.push({id:uuid(),event_name,price:price(),metadata});if(queue.length>150)queue.splice(0,queue.length-150);};
 function flush(urgent=false){
  if(!enabled||!queue.length||(sending&&!urgent)||!production)return;
  const batch=queue.splice(0,30);sending=true;
  win.fetch('/.netlify/functions/delta-vision-track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...context,consent:true,events:batch}),keepalive:true,signal:AbortSignal.timeout(10000)})
   .then(r=>{if(!r.ok&&enabled)queue.unshift(...batch);}).catch(()=>{if(enabled)queue.unshift(...batch);}).finally(()=>{sending=false;if(queue.length>150)queue=queue.slice(-150);});
 }
 function decorate(){buttons.forEach(el=>{try{const url=new URL(el.href);if(!['/checkout/delta-vision-1','/checkout/delta-vision-standard'].includes(url.pathname)||url.hostname!=='sonnycourt.spiffy.co')return;
  if(enabled){url.searchParams.set('dv_visit',context.visit_id);url.searchParams.set('utm_term','dv1_'+context.visit_id);for(const key of ['source','medium','campaign'])if(context[key])url.searchParams.set('utm_'+key,context[key]);}
  else {url.searchParams.delete('dv_visit');if(url.searchParams.get('utm_term')?.startsWith('dv1_'))url.searchParams.delete('utm_term');}
  if(el.href!==url.href)el.href=url.href;
 }catch{}});}
 function start(){
  if(enabled||!production||!win.crypto?.randomUUID)return;
  const old=read(IDENTITY),known=old&&/^[a-f0-9-]{36}$/.test(old.id)&&Date.now()-old.at<90*86400000;
  const visitor=known?old.id:uuid();write(IDENTITY,{id:visitor,at:Date.now()});
  const params=new URLSearchParams(win.location.search);let ref='';try{ref=new URL(doc.referrer).hostname;}catch{}
  context={visit_id:uuid(),visitor_id:visitor,visit_started_at:new Date().toISOString(),source:safeLabel(params.get('utm_source'))||safeLabel(ref)||'direct',medium:safeLabel(params.get('utm_medium')),campaign:safeLabel(params.get('utm_campaign'),100),device:win.matchMedia('(max-width:760px)').matches?'mobile':'desktop',is_returning:!!known};
  enabled=true;active=0;maxScroll=0;watch=new DeltaWatch();firstPlay=playing;sectionTimes.clear();seen.clear();visibleSince.clear();lastTick=win.performance.now();lastAction=lastTick;emit('visit');if(playing)emit('video',{action:'play'});decorate();flush();
 }
 function stop(){enabled=false;queue=[];watch.reset();try{win.localStorage.removeItem(IDENTITY);}catch{}decorate();}
 const panel=doc.querySelector('#dv-analytics-consent');
 doc.querySelectorAll('[data-dv-consent]').forEach(button=>button.addEventListener('click',()=>{const allowed=button.dataset.dvConsent==='yes';write(KEY,{allowed,at:Date.now()});if(panel)panel.hidden=true;if(allowed)start();else stop();}));
 doc.querySelector('#dv-analytics-preferences')?.addEventListener('click',()=>{if(panel)panel.hidden=false;});
 win.addEventListener('storage',e=>{if(e.key===KEY){if(consent()===true)start();else stop();}});
 if(consent()===true)start();else if(consent()===null&&panel)panel.hidden=false;
 const visible=el=>{const r=el.getBoundingClientRect(),style=win.getComputedStyle(el);return !doc.hidden&&style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)!==0&&r.width>0&&Math.min(r.bottom,win.innerHeight)-Math.max(0,r.top)>=Math.min(r.height*.5,120);};
 ['pointerdown','keydown','scroll','touchstart'].forEach(type=>win.addEventListener(type,()=>lastAction=win.performance.now(),{passive:true}));
 buttons.forEach(el=>['click','auxclick','contextmenu'].forEach(type=>el.addEventListener(type,event=>{if(!enabled)return;decorate();if(type!=='contextmenu'&&(type!=='auxclick'||event.button===1)){emit('cta_click',{target:el.dataset.dvAnalyticsCta,elapsed:elapsed()});snapshot();flush(true);}})));
 // Urgency may update native checkout links at expiration. Decorate without altering its pricing logic.
 const linksObserver=new MutationObserver(()=>{if(enabled)decorate();});buttons.forEach(el=>linksObserver.observe(el,{attributes:true,attributeFilter:['href']}));
 function tick(){const now=win.performance.now(),delta=Math.min(2,(now-lastTick)/1000);lastTick=now;if(!enabled)return;
  const engaged=!doc.hidden&&(playing||now-lastAction<60000);
  if(engaged){active+=delta;for(const el of sections)if(visible(el))sectionTimes.set(el.id,(sectionTimes.get(el.id)||0)+delta);}
  if(!doc.hidden){maxScroll=Math.max(maxScroll,Math.min(100,Math.round(100*(win.scrollY+win.innerHeight)/Math.max(win.innerHeight,doc.documentElement.scrollHeight))));
   for(const el of buttons){const key=el.dataset.dvAnalyticsCta;if(!visible(el)){visibleSince.delete(key);continue;}if(!visibleSince.has(key))visibleSince.set(key,now);if(!seen.has(key)&&now-visibleSince.get(key)>=1000){seen.add(key);emit('cta_seen',{target:key,elapsed:elapsed()});}}
  }
 }
 function snapshot(){if(!enabled)return;emit('heartbeat',{active:Math.round(active),scroll:maxScroll});for(const [target,seconds]of sectionTimes)if(seconds>=1)emit('section',{target,seconds:Math.round(seconds)});if(progressDirty){emit('video_progress',watch.snapshot());progressDirty=false;}}
 win.setInterval(tick,1000);win.setInterval(()=>{snapshot();flush();},15000);
 doc.addEventListener('visibilitychange',()=>{watch.reset();if(doc.hidden){snapshot();flush(true);}else lastTick=win.performance.now();});
 win.addEventListener('pagehide',()=>{snapshot();flush(true);});
 doc.addEventListener('dv:video',event=>{const data=event.detail||{};
  if(data.action==='timeupdate'){watch.sample(Number(data.seconds),Number(data.duration),win.performance.now(),playing,enabled&&!doc.hidden);progressDirty=true;return;}
  if(data.action==='requested'){requestedAt=win.performance.now();win.setTimeout(()=>{if(enabled&&!firstPlay){emit('error',{code:'video_no_start'});flush();}},10000);}
  if(data.action==='play')playing=true;
  if(['pause','ended','seeked'].includes(data.action)){if(data.action!=='seeked')playing=false;watch.reset();}
  if(data.action==='error'){emit('error',{code:data.code==='player_api'?'player_api':'player_error'});return;}
  const metadata={action:data.action};if(data.action==='play'&&!firstPlay){firstPlay=true;if(requestedAt!==null)metadata.startup=Math.min(600000,Math.round(win.performance.now()-requestedAt));}
  emit('video',metadata);
 });
 let errorCount=0;for(const [type,code]of [['error','js_error'],['unhandledrejection','promise_error']])win.addEventListener(type,()=>{if(enabled&&errorCount++<5)emit('error',{code});});
 try{const observer=new PerformanceObserver(list=>{if(!enabled)return;for(const e of list.getEntries())if(e.entryType==='largest-contentful-paint')emit('performance',{metric:'lcp_ms',value:Math.round(e.startTime)});});observer.observe({type:'largest-contentful-paint',buffered:true});}catch{}
 win.addEventListener('load',()=>{const n=win.performance.getEntriesByType('navigation')[0];if(n)emit('performance',{metric:'load_ms',value:Math.round(n.loadEventStart)});},{once:true});
 return {snapshot,flush};
}
