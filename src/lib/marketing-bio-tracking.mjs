const ENDPOINT='/.netlify/functions/marketing-bio-event';
const sourceNames={tiktok:'tiktok',youtube:'youtube',instagram:'instagram',facebook:'facebook',mailerlite:'email',email:'email',sms:'sms',meta:'meta_ads',meta_ads:'meta_ads'};
export function initBioTracking(doc=document,win=window) {
  const params=new URLSearchParams(win.location.search);
  if(!['sonnycourt.com','www.sonnycourt.com'].includes(win.location.hostname)||!['/links','/links/'].includes(win.location.pathname)
    ||params.has('safe_deploy_check')||params.has('preview')||win.__scBioStarted||!win.crypto?.randomUUID)return;
  win.__scBioStarted=true;
  const id=win.crypto.randomUUID(),rawCode=params.get('sc_link'),code=/^[a-f0-9]{12}$/.test(rawCode||'')?rawCode:null;
  const rawSource=params.get('utm_source')?.toLowerCase()||'',source=Object.hasOwn(sourceNames,rawSource)?sourceNames[rawSource]:(rawSource?'other':'direct');
  let firstChoice=null,eligible=false,timer;
  const acknowledged=new Set(),attempts=new Map(),inFlight=new Set();
  const payload=choice=>({id,code,source,choice,path:'/links/',visible:true});
  async function send(choice){
    const key=choice||'visit';
    if(acknowledged.has(key)||inFlight.has(key)||(attempts.get(key)||0)>=3)return;
    attempts.set(key,(attempts.get(key)||0)+1);inFlight.add(key);
    try{
      const res=await win.fetch(ENDPOINT,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(choice)),keepalive:true,signal:AbortSignal.timeout(4000)});
      if(res.ok)acknowledged.add(key);
    }catch{/* Measurement must never interrupt either programme link. */}
    finally{
      inFlight.delete(key);
      if(!acknowledged.has(key)&&(attempts.get(key)||0)<3)win.setTimeout(()=>void send(choice),1500*(attempts.get(key)||1));
    }
  }
  const schedule=()=>{win.clearTimeout(timer);if(!doc.hidden&&!firstChoice)timer=win.setTimeout(()=>{if(!doc.hidden){eligible=true;void send(null);}},1200);};
  const choose=event=>{
    if(event.isTrusted===false||doc.hidden||firstChoice||(event.type==='auxclick'&&event.button!==1)||(event.type==='click'&&event.button>0))return;
    const key=event.target?.closest?.('[data-bio-link]')?.dataset.bioLink;
    const choice=key==='masterclass'?'mc2':key==='delta-vision'?'delta':null;
    if(!choice)return;
    firstChoice=choice;eligible=true;win.clearTimeout(timer);
    // Send immediately even if the visible-page request is still in flight.
    // SQL merges out-of-order requests and retains the first choice.
    void send(choice);
  };
  doc.addEventListener('click',choose);doc.addEventListener('auxclick',choose);
  doc.addEventListener('visibilitychange',schedule);
  win.addEventListener('pagehide',()=>{
    if(!eligible||acknowledged.has(firstChoice||'visit'))return;
    try{win.navigator.sendBeacon?.(ENDPOINT,new Blob([JSON.stringify(payload(firstChoice))],{type:'application/json'}));}catch{}
  });
  schedule();
}
