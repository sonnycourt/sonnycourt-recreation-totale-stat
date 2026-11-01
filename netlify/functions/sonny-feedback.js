import { getCloserCookieSecret, getCloserCookieValue, verifyCloserToken } from './lib/closer-access-crypto.mjs';
import { getSupabaseConfig } from './lib/supabase-rest.mjs';
import { normalizeEmail, validEmail, uuid, sourceId, questionText, validReply, REPLY_FIELDS, SOURCE_FIELDS } from './lib/sonny-feedback.mjs';

const reply = (status, body) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
async function database(path, body) {
  const {url,key} = getSupabaseConfig();
  if (!url || !key) throw Error('configuration');
  const response = await fetch(`${url}/rest/v1/${path}`, {method:body === undefined ? 'GET':'POST', headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body === undefined ? {}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error('database'),{reason:data?.message});
  return data;
}
export function createHandler(db = database) {
  return async req => {
    if (!['GET','POST'].includes(req.method)) return reply(405,{error:'Méthode non autorisée.'});
    const url = new URL(req.url), origin = req.headers.get('origin');
    if (req.headers.get('x-sonny-feedback') !== '1' || (origin && origin !== url.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403,{error:'Accès refusé.'});
    const secret = getCloserCookieSecret();
    const token = secret && verifyCloserToken(getCloserCookieValue(req.headers.get('cookie') || ''),secret);
    if (!token || !Number.isSafeInteger(token.cid)) return reply(401,{error:'Connecte-toi avec ton compte propriétaire du CRM.'});
    try {
      const account = (await db(`closer_access_codes?id=eq.${token.cid}&active=eq.true&select=id,label,email,password_hash`))?.[0];
      if (!account?.email || !account.password_hash) return reply(401,{error:'Session expirée.'});
      const staff = (await db(`onboarding_staff?closer_id=eq.${token.cid}&active=eq.true&select=role`))?.[0];
      if (staff?.role !== 'owner') return reply(403,{error:'Cet espace est réservé à Sonny. Les retours se consultent dans la fiche CRM.'});
      const actor = {name:account.label || 'Sonny',role:'owner'};
      if (req.method === 'GET') {
        const email = url.searchParams.get('email');
        if (url.searchParams.get('view') === 'match') {
          const normalized = normalizeEmail(email);
          if (!validEmail(normalized)) return reply(400,{error:'Adresse email invalide.'});
          const matches = await db(`onboarding_cases?email=eq.${encodeURIComponent(normalized)}&select=id,display_name,email&limit=2`);
          return reply(200,{matches});
        }
        const id = url.searchParams.get('id'), feedback = url.searchParams.get('feedback_id');
        if (id || feedback) {
          if ((id && !uuid(id)) || (feedback && !sourceId(feedback))) return reply(400,{error:'Demande invalide.'});
          const saved = (await db(`es2_feedback_replies?${id ? `id=eq.${id}`:`feedback_id=eq.${Number(feedback)}`}&select=${REPLY_FIELDS}&limit=1`))?.[0];
          if (saved) return reply(200,{item:saved,actor});
          if (id) return reply(404,{error:'Retour introuvable.'});
          const source = (await db(`es2_feedback?id=eq.${Number(feedback)}&select=${SOURCE_FIELDS}&limit=1`))?.[0];
          if (!source) return reply(404,{error:'Bilan introuvable.'});
          return reply(200,{item:{id:null,feedback_id:source.id,email:normalizeEmail(source.email),prenom:source.prenom || '',question:questionText(source),answer:'',answered_on:null,version:0,received_at:source.created_at},actor});
        }
        const filter = url.searchParams.get('filter') || 'pending', search = url.searchParams.get('search') || '', offset = Number(url.searchParams.get('offset') || 0);
        if (!['pending','answered','all'].includes(filter) || search.length > 120 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return reply(400,{error:'Filtre invalide.'});
        return reply(200,{...await db('rpc/es2_feedback_inbox',{p_actor:token.cid,p_filter:filter,p_search:search,p_offset:offset}),actor});
      }
      if (!req.headers.get('content-type')?.startsWith('application/json')) return reply(415,{error:'Format invalide.'});
      const text = await req.text();
      if (text.length > 1250000) return reply(413,{error:'Texte trop long. Ton brouillon est conservé.'});
      let body; try {body = JSON.parse(text);} catch {return reply(400,{error:'Requête invalide.'});}
      if (!validReply(body)) return reply(400,{error:'Vérifie l’email, la date, la demande et ta réponse (100 000 caractères maximum par texte).'});
      const item = await db('rpc/es2_feedback_save_reply',{p_actor:token.cid,p_id:body.id,p_command:body.command_id,p_version:body.version,p_feedback:body.feedback_id || null,p_email:body.email,p_prenom:body.prenom,p_question:body.question,p_answer:body.answer,p_date:body.answered_on});
      return reply(200,{item,actor});
    } catch (error) {
      if (error.reason === 'feedback_forbidden') return reply(403,{error:'Accès refusé.'});
      if (['feedback_version_conflict','feedback_command_conflict','feedback_identity_conflict'].includes(error.reason)) return reply(409,{error:'Ce retour a changé ou son identité ne correspond pas. Copie ton brouillon puis recharge la demande avant de réessayer.'});
      if (error.reason === 'feedback_invalid') return reply(400,{error:'Vérifie les informations. Rien n’a été enregistré.'});
      return reply(503,{error:'Retours indisponibles : connexion ou migration SQL à vérifier. Tes saisies restent affichées.'});
    }
  };
}
export default createHandler();
