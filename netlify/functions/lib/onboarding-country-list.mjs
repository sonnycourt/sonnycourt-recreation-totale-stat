import {countryGroupPage} from './onboarding-country-groups.mjs';
import {isUuid} from './onboarding-domain.mjs';

// Lecture minimale paginée, sans notes ni historique. Le scope provient seulement
// de la session vérifiée. Ne jamais renvoyer un résultat partiel comme un total.
export async function listCountryGroup(db,scope,options) {
  const rows=[];
  const select='id,display_name,preferred_name,email,phone,country,country_override,city,status,followup_at,purchased_at';
  for(let offset=0;;offset=rows.length){
    const batch=await db(`onboarding_cases?select=${select}${scope}&order=id.asc&limit=1000&offset=${offset}`);
    if(!Array.isArray(batch))throw new Error('country list unavailable');
    if(!batch.length)break;
    rows.push(...batch);
    if(rows.length>10000)throw new Error('country list limit');
  }
  const page=countryGroupPage(rows,options);
  if(!page.cases.length)return page;
  const ids=page.cases.map(row=>row.id);
  if(!ids.every(isUuid))throw new Error('invalid case');
  const full=await db(`onboarding_cases?id=in.(${ids.join(',')})${scope}&select=*`);
  const byId=new Map(full.map(row=>[row.id,row]));
  // Une attribution a pu changer pendant la lecture : ne pas afficher des
  // résultats incomplets ni sortir du scope pour récupérer la fiche manquante.
  if(ids.some(id=>!byId.has(id)))throw new Error('country list changed');
  return {...page,cases:ids.map(id=>byId.get(id))};
}
