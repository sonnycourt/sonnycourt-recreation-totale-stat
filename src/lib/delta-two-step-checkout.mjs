import { inspira } from '../data/inspira.mjs';
export const SPIFFY_ORIGIN='https://sonnycourt.spiffy.co';
export function paymentUrl(identity,offer,parentHref,visit){
 const url=new URL(offer.checkoutUrl),parent=new URL(parentHref);
 if(url.origin!==SPIFFY_ORIGIN || !['/checkout/delta-vision-1','/checkout/delta-vision-standard'].includes(url.pathname))throw Error('invalid_checkout');
 // Anonymous warm-up must never contain identity or attribution data.
 for(const k of ['name_first','email','dv_visit','dv_preload'])url.searchParams.delete(k);
 for(const [k,v]of Object.entries({locale:'fr',dv_embed:'2',dv_parent_origin:parent.origin}))url.searchParams.set(k,v);
 if(identity){url.searchParams.set('name_first',identity.firstName);url.searchParams.set('email',identity.email);}else url.searchParams.set('dv_preload','1');
 url.searchParams.set('elements',btoa(JSON.stringify({modality:'inline',uid:'delta-two-step',from:parent.origin+parent.pathname,handles:{}})));
 if(identity&&/^[a-f0-9-]{36}$/i.test(visit||''))url.searchParams.set('dv_visit',visit);
 return url.href;
}
export function paymentMessage(event,frame,price){
 if(event.origin!==SPIFFY_ORIGIN||event.source!==frame.contentWindow)return null;
 let data=event.data;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return null;}}
 if(!data||typeof data!=='object')return null;
 if(data.version===2){
  if(data.type==='dv:payment-warm'&&data.price===price)return {warm:true};
  if(data.type==='dv:payment-ready')return data.identityReady===true&&data.price===price?{ready:true}:{error:true};
  if(data.type==='dv:payment-error')return {error:true};
  if(data.type==='dv:payment-height'&&Number.isFinite(data.height)&&data.height>=100&&data.height<=10000)return {height:Math.min(2400,Math.ceil(data.height))};
 }
 if(['order:success','redirect'].includes(data.event)){
  try{const raw=data.data?.forward||data.data?.url||data.url;if(typeof raw!=='string')return null;const u=new URL(raw,SPIFFY_ORIGIN);if(u.username||u.password)return null;
   if(u.origin==='https://sonnycourt.com'&&u.pathname==='/delta-vision/merci/'||u.origin===SPIFFY_ORIGIN&&/^\/(thanks|thank-you)(\/|$)/.test(u.pathname))return {redirect:u.href};
  }catch{}
 }
 return null;
}
export function mountPayment(slot,identity,offer,{view=slot.ownerDocument.defaultView,visit}={}){
 const doc=slot.ownerDocument,frame=doc.createElement('iframe'),status=doc.createElement('p');
 frame.title=`Paiement sécurisé Delta Vision — ${offer.price} €`;frame.allow='payment';frame.referrerPolicy='no-referrer';frame.style.cssText='border:0;width:100%;height:0;visibility:hidden';frame.tabIndex=-1;frame.dataset.paymentPhase=identity?'loading':'preloading';
 status.className='dvp-message';status.setAttribute('role','status');status.textContent='Chargement du paiement sécurisé…';slot.replaceChildren(status,frame);slot.setAttribute('aria-busy','true');
 let loaded=false,ready=false,height=0,dead=false,timer,replacement,warm=false,activated=!!identity,fallbackTimer,identitySent=false;
 const anonymous=!identity;
 const reveal=()=>{if(dead||!activated||!loaded||!ready||!height)return;view.clearTimeout(timer);view.clearTimeout(fallbackTimer);status.hidden=true;frame.style.height=height+'px';frame.style.visibility='visible';frame.tabIndex=0;frame.dataset.paymentPhase='ready';slot.setAttribute('aria-busy','false');};
 const fail=()=>{if(dead)return;dead=true;view.clearTimeout(timer);frame.remove();slot.setAttribute('aria-busy','false');status.hidden=false;status.textContent='Le paiement sécurisé ne peut pas s’afficher. Si tu as déjà validé un paiement, vérifie ton email de confirmation avant de réessayer. ';
  const retry=doc.createElement('button');retry.type='button';retry.textContent='Réessayer';retry.addEventListener('click',()=>{destroy();replacement=mountPayment(slot,identity,offer,{view,visit});});
  const link=doc.createElement('a');link.href=offer.checkoutUrl;link.textContent='Ouvrir le paiement sécurisé';link.rel='noreferrer';status.append(retry,doc.createTextNode(' · '),link);
 };
 const deliver=()=>{if(!activated||!warm||identitySent||dead)return;identitySent=true;view.clearTimeout(fallbackTimer);frame.contentWindow.postMessage({type:'dv:payment-identity',version:2,firstName:identity.firstName,email:identity.email,visit},SPIFFY_ORIGIN);};
 const fallback=()=>{if(dead||!activated||warm)return;destroy();replacement=mountPayment(slot,identity,offer,{view,visit});};
 const receive=event=>{const m=paymentMessage(event,frame,offer.price);if(!m||dead)return;if(m.warm){warm=true;frame.dataset.paymentPhase='warm';deliver();return;}if(!activated)return;if(m.error){fail();return;}if(m.redirect){view.location.assign(m.redirect);return;}if(m.ready)ready=true;if(m.height)height=m.height;reveal();};
 const destroy=()=>{dead=true;replacement?.destroy();view.clearTimeout(timer);view.clearTimeout(fallbackTimer);view.removeEventListener('message',receive);slot.replaceChildren();};
 const activate=(nextIdentity,nextVisit)=>{if(activated||dead)return false;identity=nextIdentity;visit=nextVisit;activated=true;timer=view.setTimeout(fail,20000);deliver();if(loaded&&!warm)fallbackTimer=view.setTimeout(fallback,1200);return true;};
 frame.addEventListener('load',()=>{loaded=true;if(anonymous&&activated&&!warm)fallbackTimer=view.setTimeout(fallback,1200);reveal();});view.addEventListener('message',receive);frame.src=paymentUrl(identity,offer,view.location.href,visit);if(activated)timer=view.setTimeout(fail,20000);
 return {destroy,activate,price:offer.price,checkoutUrl:offer.checkoutUrl};
}
export function initTwoStepCheckout(doc,win,urgency){
 const dialog=doc.querySelector('[data-dvp-dialog]');if(!dialog||dialog.dataset.bound)return;dialog.dataset.bound='true';
 const form=dialog.querySelector('[data-dvp-identity]'),error=dialog.querySelector('[data-dvp-identity-error]'),slot=dialog.querySelector('[data-dvp-payment-slot]');
 let busy=false,payment,lockedOffer,opener;
 const show=step=>{dialog.dataset.step=step;dialog.querySelectorAll('[data-dvp-panel]').forEach(p=>{p.hidden=p.dataset.dvpPanel!==step;p.inert=p.hidden;});dialog.querySelectorAll('[data-dvp-step]').forEach(p=>{if(p.dataset.dvpStep===step)p.setAttribute('aria-current','step');else p.removeAttribute('aria-current');p.classList.toggle('is-done',step==='payment'&&p.dataset.dvpStep==='identity');});dialog.setAttribute('aria-labelledby','dvp-title-'+step);dialog.scrollTop=0;dialog.querySelector('#dvp-title-'+step).focus({preventScroll:true});};
 function render(){const current=urgency.render(),offer=lockedOffer||current;
  dialog.querySelector('[data-dvp-price]').textContent=offer.price;dialog.querySelector('[data-dvp-before]').hidden=offer.price>=inspira.referencePrice;dialog.querySelector('[data-dvp-discount]').hidden=offer.price>=inspira.referencePrice;
  dialog.querySelector('[data-dvp-launch]').textContent=offer.expired?'Delta Vision':current.expired?'Ton tarif pour ce paiement':'Offre de lancement';
  const clock=dialog.querySelector('[data-dvp-clock]');clock.hidden=current.expired||offer.expired;
  for(const [k,v]of Object.entries({hours:Math.floor(current.remaining/3600),minutes:Math.floor(current.remaining/60)%60,seconds:current.remaining%60}))clock.querySelector('[data-'+k+']').textContent=String(v).padStart(2,'0');
  return current;
 }
 const open=link=>{opener=link;urgency.sync();dialog.showModal();show('identity');render();};
 for(const link of doc.querySelectorAll('[data-dv-buy]')){link.setAttribute('aria-haspopup','dialog');link.addEventListener('click',event=>{if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;event.preventDefault();open(link);});}
 const reset=()=>{payment?.destroy();payment=null;lockedOffer=null;};
 const prepare=()=>{if(!dialog.open||dialog.dataset.step!=='identity'||busy)return;const offer=urgency.render();if(payment&&(payment.price!==offer.price||payment.checkoutUrl!==offer.checkoutUrl)){payment.destroy();payment=null;}if(!payment)payment=mountPayment(slot,null,offer,{view:win});};
 // No field values are read or transmitted during speculative loading.
 form.addEventListener('input',prepare);
 dialog.querySelector('[data-dvp-close]').addEventListener('click',()=>{if(!busy)dialog.close();});dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>{reset();opener?.focus({preventScroll:true});});
 dialog.addEventListener('click',e=>{if(e.target!==dialog||busy)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();});
 dialog.querySelector('[data-dvp-back]').addEventListener('click',()=>{reset();show('identity');});
 form.elements.firstName.addEventListener('input',()=>form.elements.firstName.setCustomValidity(''));
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;form.elements.firstName.setCustomValidity(form.elements.firstName.value.trim()?'':'Indique ton prénom.');if(!form.reportValidity())return;
  const identity={firstName:form.elements.firstName.value.trim(),email:form.elements.email.value.trim().toLowerCase(),website:form.elements.website.value};
  prepare();busy=true;error.hidden=true;const button=form.querySelector('[type=submit]');button.disabled=true;button.setAttribute('aria-busy','true');
  try{const response=await win.fetch('/.netlify/functions/delta-vision-register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(identity),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok||result.ok!==true)throw Error('registration_failed');
   urgency.sync();lockedOffer=urgency.render();render();dialog.querySelector('[data-dvp-email]').textContent=identity.email;show('payment');
   // Only the authenticated provider Purchase webhook grants buyer status/access.
   const visit=new URL(opener?.href||lockedOffer.checkoutUrl).searchParams.get('dv_visit');
   if(!payment||payment.price!==lockedOffer.price||payment.checkoutUrl!==lockedOffer.checkoutUrl||!payment.activate(identity,visit)){payment?.destroy();payment=mountPayment(slot,identity,lockedOffer,{view:win,visit});}
  }catch{error.textContent='Impossible d’enregistrer pour le moment. Réessaie dans quelques instants ou ';const link=doc.createElement('a');link.href=urgency.render().checkoutUrl;link.textContent='ouvre le paiement sécurisé';error.append(link);error.hidden=false;}
  finally{busy=false;button.disabled=false;button.removeAttribute('aria-busy');}
 });
 win.setInterval(()=>{if(dialog.open)render();},1000);
 if(new URLSearchParams(win.location.search).get('popup')==='1')open(doc.querySelector('[data-dv-buy]'));
 return {render};
}
