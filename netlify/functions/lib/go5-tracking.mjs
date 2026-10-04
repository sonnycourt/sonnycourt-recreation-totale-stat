import {randomUUID} from 'node:crypto';
import {getStore} from '@netlify/blobs';
export const go5Store=()=>getStore({name:'go5-redirect-events',consistency:'strong'});
export const localDay=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function classifyGo5(req){
  const ua=req.headers.get('user-agent')||'';
  const purpose=(req.headers.get('purpose')||'')+' '+(req.headers.get('sec-purpose')||'');
  return /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|headless|python|monitor/i.test(ua)||/prefetch|preview/i.test(purpose)||!ua?'automated':'unclassified';
}
export function makeGo5Redirect({record=(key,event)=>go5Store().setJSON(key,event),now=()=>new Date(),timeoutMs=2000}={}){
  return async req=>{
    if(!['GET','HEAD'].includes(req.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    const headers={'Location':'/es2-offre-speciale/'+new URL(req.url).search,'Cache-Control':'no-store, max-age=0','Netlify-CDN-Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
    if(req.method==='GET'){
      const date=now(),bucket=classifyGo5(req);
      let timer;
      try{
        await Promise.race([
          Promise.resolve().then(()=>record(`${localDay(date)}/${bucket}/${randomUUID()}`,{at:date.toISOString(),bucket})),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),timeoutMs);}),
        ]);
        headers['X-Go5-Tracking']='recorded';
      }catch(error){headers['X-Go5-Tracking']='unavailable';console.warn('go5_tracking_unavailable',error?.name||'Error');}
      finally{clearTimeout(timer);}
    }
    // Analytics failure must never prevent access to the offer.
    return new Response(null,{status:302,headers});
  };
}
