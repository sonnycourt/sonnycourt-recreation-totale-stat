import { marketingSessionCookie } from './lib/marketing-auth.mjs';
import { json, sameOrigin } from './lib/marketing-links.mjs';
export default async req=>{
  if(req.method!=='POST') return json(405,{error:'Méthode non autorisée.'});
  if(!sameOrigin(req,true)) return json(403,{error:'Accès refusé.'});
  return json(200,{ok:true},{'Set-Cookie':marketingSessionCookie()});
};
