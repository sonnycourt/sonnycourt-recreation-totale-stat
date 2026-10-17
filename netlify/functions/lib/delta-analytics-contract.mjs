export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const label = (value,max=80) => typeof value==='string' && /^[\p{L}\p{N} ._:/-]*$/u.test(value) ? value.slice(0,max) : '';
export const targets=['hero','histoire','ressentir','garantie','closing','sticky'];
export const sections=['presentation','histoire','ressentir','methode','science','garantie','tarif'];
export const json=(status,data,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...extra}});
const number=(v,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
export function cleanBatch(body,now=Date.now()) {
 if(!body||body.consent!==true||!uuid(body.visit_id)||!uuid(body.visitor_id)||!Array.isArray(body.events)||!body.events.length||body.events.length>30)throw Error('batch');
 const start=Date.parse(body.visit_started_at);
 if(!Number.isFinite(start)||start>now+60000||start<now-86400000)throw Error('date');
 if(!['mobile','desktop'].includes(body.device)||typeof body.is_returning!=='boolean')throw Error('context');
 return body.events.map(event=>{
  if(!uuid(event.id)||![27,47,97,147].includes(event.price))throw Error('event');
  const m=event.metadata||{},metadata={};
  const copyNum=(key,max)=>{if(!number(m[key],max))throw Error(key);metadata[key]=m[key];};
  switch(event.event_name){
   case 'visit':break;
   case 'heartbeat':copyNum('active',86400);copyNum('scroll',100);break;
   case 'section':if(!sections.includes(m.target))throw Error('section');metadata.target=m.target;copyNum('seconds',86400);break;
   case 'cta_seen':case 'cta_click':if(!targets.includes(m.target))throw Error('target');metadata.target=m.target;copyNum('elapsed',86400);break;
   case 'video':if(!['requested','ready','play','pause','seeked','ended'].includes(m.action))throw Error('action');metadata.action=m.action;if(m.startup!==undefined)copyNum('startup',600000);break;
   case 'video_progress':copyNum('watched',7200);copyNum('duration',7200);if(!Array.isArray(m.bins)||m.bins.length>720)throw Error('bins');metadata.bins=m.bins.map(pair=>{if(!Array.isArray(pair)||pair.length!==2||!Number.isInteger(pair[0])||!number(pair[0],719)||!number(pair[1],10))throw Error('bin');return pair;});break;
   case 'performance':if(!['lcp_ms','load_ms','cls','inp_ms'].includes(m.metric))throw Error('metric');metadata.metric=m.metric;copyNum('value',600000);break;
   case 'error':if(!['js_error','promise_error','player_api','player_error','video_no_start'].includes(m.code))throw Error('error');metadata.code=m.code;break;
   case 'checkout_loaded':if(!['41049','41096'].includes(m.checkout))throw Error('checkout');metadata.checkout=m.checkout;break;
   default:throw Error('name');
  }
  return {id:event.id,visit_id:body.visit_id,visitor_id:body.visitor_id,visit_started_at:new Date(start).toISOString(),event_name:event.event_name,source:label(body.source),medium:label(body.medium),campaign:label(body.campaign,100),device:body.device,is_returning:body.is_returning,price:event.price,metadata};
 });
}
