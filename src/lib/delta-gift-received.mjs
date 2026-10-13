import {giftRequest,readGiftToken} from './delta-gifts-client.mjs';

export function giftReceivedState(result) {
  if(result.state==='active') {
    const url=new URL(result.url);
    if(url.origin!=='https://volt.sonnycourt.com' || url.pathname!=='/c/delta-vision' || url.username || url.password || url.search || url.hash)throw new Error('invalid_access');
    return {mode:'active',url:url.href,text:'Ton cadeau est activé. La leçon et la séance guidée t’attendent dans Volt.'};
  }
  if(result.state==='assistance')return {mode:'assistance',text:'Ton cadeau est enregistré. Écris à info@sonnycourt.com avec l’adresse utilisée : nous allons finaliser ton accès.'};
  if(result.state==='activating' || result.state==='assigned')return {mode:'pending',text:'Nous préparons ton accès à Delta Vision. Cela peut prendre quelques instants…'};
  throw new Error('unexpected_gift_state');
}

export function initGiftReceived(doc=document,{view=window,request=giftRequest}={}) {
  const form=doc.querySelector('[data-gift-activation]'),message=doc.querySelector('[data-gift-message]');
  if(!form || !message)return;
  const token=readGiftToken(view),button=form.querySelector('button'),error=doc.querySelector('[data-gift-error]'),success=doc.querySelector('[data-gift-success]'),access=doc.querySelector('[data-gift-access]'),retry=doc.querySelector('[data-gift-retry]');
  let identity=null,busy=false,timer=null,attempts=0;
  const stop=()=>{view.clearTimeout(timer);timer=null;};
  const fail=e=>{
    stop();busy=false;button.disabled=false;error.hidden=false;
    const code=e.code || e.message;
    error.textContent=code==='gift_mismatch'?'Utilise exactement l’adresse email qui a reçu le cadeau. Vérifie aussi que tu as ouvert son lien personnel.':code==='link_invalid'?'Ce lien n’est plus valide. Écris à info@sonnycourt.com pour retrouver ton cadeau.':code==='not_ready'?'L’activation est momentanément indisponible. Ton cadeau est conservé : réessaie dans quelques instants.':'La connexion a été interrompue. Ton cadeau est conservé. Réessaie dans quelques instants.';
    if(identity)retry.hidden=false;
  };
  const render=result=>{
    const state=giftReceivedState(result);message.textContent=state.text;error.hidden=true;retry.hidden=true;
    if(state.mode==='active'){stop();form.hidden=true;success.hidden=false;access.href=state.url;return;}
    if(state.mode==='assistance'){stop();busy=false;button.disabled=false;return;}
    button.disabled=true;
    if(attempts>=36){busy=false;message.textContent='Ton cadeau est bien enregistré. L’ouverture prend un peu plus de temps ; tu peux vérifier à nouveau ou revenir avec ce même lien.';retry.hidden=false;return;}
    timer=view.setTimeout(check,5000);
  };
  const check=async()=>{
    if(!identity)return;attempts++;
    try{render(await request({action:'status',token,email:identity.email}));}catch(e){fail(e);}
  };
  if(!token){form.hidden=true;message.textContent='Pour recevoir ton cadeau, ouvre le lien personnel dans l’email « Une expérience Delta Vision t’a été offerte ». Si tu ne le retrouves pas, vérifie tes courriers indésirables ou écris à info@sonnycourt.com.';return;}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy || !form.reportValidity())return;
    identity={firstName:form.elements.namedItem('firstName').value.trim(),email:form.elements.namedItem('email').value.trim().toLowerCase()};
    if(!identity.firstName){error.hidden=false;error.textContent='Renseigne ton prénom pour préparer ton accès.';return;}
    busy=true;button.disabled=true;error.hidden=true;retry.hidden=true;attempts=0;stop();message.textContent='Vérification de ton cadeau…';
    try{render(await request({action:'recognize',token,...identity}));}catch(e){fail(e);}
  });
  retry.addEventListener('click',()=>{stop();attempts=0;retry.hidden=true;error.hidden=true;check();});
  view.addEventListener('pagehide',stop);
}
