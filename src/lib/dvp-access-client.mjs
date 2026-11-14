export const DVP_TOKEN_KEY='dvp_access_token_v1';
export const validDvpToken=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function hashDvpToken(win){return new URLSearchParams(win.location.hash.slice(1)).get('dvp');}
export function readDvpToken(win,{remembered=false}={}){
 const explicit=hashDvpToken(win);if(explicit!==null)return validDvpToken(explicit)?explicit:null;
 if(remembered){try{const t=win.localStorage.getItem(DVP_TOKEN_KEY);return validDvpToken(t)?t:null;}catch{}}
 return null;
}
export function rememberDvpAccess(win,access){
 if(!validDvpToken(access.token))throw Error('invalid_access');
 try{win.localStorage.setItem(DVP_TOKEN_KEY,access.token);}catch{}
 const url=new URL(win.location.href);const hash=new URLSearchParams(url.hash.slice(1));hash.set('dvp',access.token);url.hash=hash.toString();win.history.replaceState(null,'',url);
}
export function priorBrowserDeadline(doc,win){
 const values=[];try{values.push(win.localStorage.getItem('dv_launch_deadline_v1'));}catch{}
 values.push(doc.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('dv_launch_deadline_v1='))?.split('=')[1]);
 const valid=values.filter(x=>/^\d{10,16}$/.test(x||'')).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0&&x<=Date.now()+86400000);
 return valid.length?Math.min(...valid):null;
}
export async function resolveDvpAccess(win,token){
 const r=await win.fetch('/.netlify/functions/dvp-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resolve',token}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('access_unavailable');const b=await r.json();
 if(!b.ok||!validDvpToken(b.access?.token)||!Number.isFinite(Date.parse(b.access.expiresAt))||!Number.isFinite(Date.parse(b.access.serverNow)))throw Error('invalid_access');return b.access;
}
