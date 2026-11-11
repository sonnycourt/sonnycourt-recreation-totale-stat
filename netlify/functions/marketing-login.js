import bcrypt from 'bcryptjs';
import { fetchAdminAuthRow, needsPasswordSetup } from './lib/admin-es2-supabase.mjs';
import { signMarketingSession, marketingSessionCookie } from './lib/marketing-auth.mjs';
import { reserveAttempt } from './lib/marketing-auth-rate-limit.mjs';
import { json, sameOrigin } from './lib/marketing-links.mjs';

export function makeLogin({readAuth=fetchAdminAuthRow,reserve=reserveAttempt,compare=bcrypt.compare}={}) {
  return async (req,context={})=>{
    if(req.method!=='POST') return json(405,{error:'Méthode non autorisée.'});
    if(!sameOrigin(req,true)) return json(403,{error:'Accès refusé.'});
    if(!req.headers.get('content-type')?.includes('application/json')) return json(415,{error:'Format JSON requis.'});
    let password;
    try {
      const raw=await req.text();
      if(raw.length>2048) return json(413,{error:'Formulaire trop volumineux.'});
      password=JSON.parse(raw)?.password;
    } catch {return json(400,{error:'Formulaire invalide.'});}
    if(typeof password!=='string' || !password || password.length>256) return json(400,{error:'Saisis ton mot de passe.'});
    try {
      // context.ip is supplied by Netlify, never trust caller forwarding headers.
      const quota=await reserve({ip:context.ip});
      if(!quota.allowed) return json(429,{error:'3 tentatives utilisées. Réessaie dans '+Math.ceil(quota.retryAfter/60)+' min.',retry_after:quota.retryAfter},{'Retry-After':String(quota.retryAfter)});
      const auth=await readAuth();
      if(!auth.ok || needsPasswordSetup(auth.row)) throw new Error('auth_unavailable');
      if(!await compare(password,auth.row.password_hash)) return json(401,{error:quota.remaining?`Mot de passe incorrect. ${quota.remaining} tentative${quota.remaining>1?'s':''} restante${quota.remaining>1?'s':''}.`:'Mot de passe incorrect. Les 3 tentatives de cette heure sont utilisées.'});
      return json(200,{ok:true},{'Set-Cookie':marketingSessionCookie(signMarketingSession(auth.row.password_hash))});
    } catch {return json(503,{error:'La connexion est momentanément indisponible. Réessaie plus tard.'});}
  };
}
export default makeLogin();
