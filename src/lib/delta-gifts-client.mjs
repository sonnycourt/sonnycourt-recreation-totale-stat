export const giftEndpoint='/.netlify/functions/delta-gifts';
export async function giftRequest(body,fetcher=fetch){
  const response=await fetcher(giftEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok || !data.ok)throw Object.assign(new Error(data.code || 'unavailable'),{code:data.code});
  return data;
}
export function readGiftToken(view=window){
  const value=new URLSearchParams(view.location.hash.slice(1)).get('gift');
  return value && value.length<=600 ? value : '';
}
export function initGiftRecognition(dialog,show,{view=window,fetcher=fetch}={}){
  const token=readGiftToken(view),text=dialog.querySelector('[data-dv-gift-status]'),access=dialog.querySelector('[data-dv-gift-access]');
  const readiness=fetcher(giftEndpoint,{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():{enabled:false}).catch(()=>({enabled:false}));
  let poll;
  dialog.addEventListener('close',()=>{view.clearTimeout(poll);});
  const render=(result,identity,attempt=0)=>{
    show('gift');access.hidden=true;
    if(result.state==='active' && result.url){
      const url=new URL(result.url);
      if(url.protocol!=='https:')throw new Error('invalid_access');
      access.href=url.href;access.hidden=false;text.textContent='Ton cadeau est activé. Retrouve la leçon et ta séance dans ton espace Delta Vision. Première visite sur VOLT ? Accepte aussi l’invitation reçue par email pour créer ton compte.';return;
    }
    if(result.state==='check_email'){text.textContent='Un cadeau t’attend. Ouvre ton email d’invitation et utilise son lien personnel pour activer ton accès, sans téléphone ni paiement.';return;}
    if(result.state==='assistance'){text.textContent='Ton cadeau est bien enregistré. Écris à info@sonnycourt.com avec l’adresse utilisée pour que nous finalisions ton accès.';return;}
    if(attempt>=24){text.textContent='Ton cadeau est bien enregistré. L’ouverture de ton accès prend un peu plus de temps. Tu peux revenir avec ton lien personnel dans quelques instants.';return;}
    text.textContent='Ton cadeau est reconnu. Nous préparons ton accès à Delta Vision…';
    poll=view.setTimeout(async()=>{
      if(!dialog.open)return;
      try{render(await giftRequest({action:'status',token,email:identity.email},fetcher),identity,attempt+1);}
      catch{text.textContent='La connexion a été interrompue. Réessaie avec ton lien personnel dans quelques instants.';}
    },5000);
  };
  return async identity=>{
    const {enabled}=await readiness;
    if(!enabled){if(token)throw new Error('gift_not_ready');return false;}
    const result=await giftRequest({action:'recognize',token,...identity},fetcher);
    if(result.state==='not_gifted')return false;
    view.clearTimeout(poll);render(result,identity);return true;
  };
}
