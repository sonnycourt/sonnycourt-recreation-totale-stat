import { getCloserCookieSecret, getCloserCookieValue, verifyCloserToken } from './lib/closer-access-crypto.mjs';
import { getSupabaseConfig } from './lib/supabase-rest.mjs';
import { FILTERS, isUuid, validateCommand, validateDeletion, presentCase } from './lib/onboarding-domain.mjs';

const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie',
} });

// Client privé dédié, délai borné. Jamais de clé ni d'erreur Supabase brute dans l'UI.
async function database(path, body) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('configuration');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error('database');
    // Seuls ces codes métier contrôlés sortent de cette couche.
    error.reason = ['onboarding_version_conflict','onboarding_forbidden','onboarding_coaching_too_early','onboarding_command_conflict','onboarding_invalid_time'].includes(data?.message) ? data.message : 'unavailable';
    throw error;
  }
  return data;
}

export function createHandler(db = database) {
  return async (req) => {
    if (!['GET','POST'].includes(req.method)) return reply(405, { error: 'Méthode non autorisée.' });
    // Le navigateur envoie cet en-tête pour GET aussi : pas de déclenchement via image/iframe tiers.
    if (req.headers.get('x-onboarding-client') !== '1') return reply(403, { error: 'Accès refusé.' });
    const origin = req.headers.get('origin');
    if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { error: 'Accès refusé.' });
    const secret = getCloserCookieSecret();
    const token = secret && verifyCloserToken(getCloserCookieValue(req.headers.get('cookie') || ''), secret);
    if (!token || !Number.isSafeInteger(token.cid)) return reply(401, { error: 'Connecte-toi pour accéder au CRM.' });
    try {
      const accounts = await db(`closer_access_codes?id=eq.${token.cid}&active=eq.true&select=id,label,email,password_hash`);
      const account = accounts?.[0];
      if (!account?.email || !account.password_hash) return reply(401, { error: 'Session expirée.' });
      const staff = (await db(`onboarding_staff?closer_id=eq.${token.cid}&active=eq.true&select=role`))?.[0];
      if (!staff) return reply(403, { error: 'Ce compte n’a pas accès à l’espace onboarding.' });
      const actor = { id: token.cid, name: account.label || 'Coach', role: staff.role };
      const scope = staff.role === 'owner' ? '' : `&assigned_closer_id=eq.${actor.id}`;

      if (req.method === 'GET') {
        const url = new URL(req.url);
        const id = url.searchParams.get('id');
        if (id) {
          if (!isUuid(id)) return reply(400, { error: 'Dossier invalide.' });
          const row = (await db(`onboarding_cases?id=eq.${id}${scope}&select=*`))?.[0];
          if (!row) return reply(404, { error: 'Dossier introuvable.' });
          const events = await db(`onboarding_events?case_id=eq.${id}&deleted_at=is.null&select=id,actor_id,kind,note,occurred_at&order=occurred_at.desc,id.desc&limit=100`);
          return reply(200, { case: presentCase(row), events:events.map(e=>({...e,can_delete:actor.role==='owner'||e.actor_id===actor.id})), actor });
        }
        const filter = url.searchParams.get('filter') || 'all';
        const search = url.searchParams.get('search') || '';
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!FILTERS.includes(filter) || search.length > 120 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return reply(400, { error: 'Filtre invalide.' });
        // Un échec de synchronisation ne masque pas les dossiers déjà importés.
        let syncWarning = false;
        try { await db('rpc/onboarding_sync_cases', {}); } catch { syncWarning = true; }
        const result = await db('rpc/onboarding_list_cases', { p_actor: actor.id, p_filter: filter, p_search: search, p_offset: offset });
        return reply(200, { ...result, cases: result.cases.map(presentCase), actor, syncWarning, refreshedAt: new Date().toISOString() });
      }

      if (!req.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'Format invalide.' });
      const text = await req.text();
      if (text.length > 40000) return reply(413, { error: 'Notes trop longues.' });
      let body; try { body = JSON.parse(text); } catch { return reply(400, { error: 'Requête invalide.' }); }
      if (body?.action === 'delete_event') {
        if (!validateDeletion(body)) return reply(400, { error:'Entrée invalide.' });
        const row = await db('rpc/onboarding_delete_event', {p_actor:actor.id,p_case:body.case_id,p_version:body.version,p_event:body.event_id});
        return reply(200, {case:presentCase(row)});
      }
      if (!validateCommand(body)) return reply(400, { error: 'Vérifie les champs du formulaire.' });
      const row = await db('rpc/onboarding_save_case_v2', {
        p_actor: actor.id, p_case: body.case_id, p_version: body.version, p_command: body.command_id,
        p_patch: body.patch, p_kind: body.kind, p_note: body.note, p_occurred_at:body.occurred_at || new Date().toISOString(),
      });
      return reply(200, { case: presentCase(row) });
    } catch (error) {
      if (error.reason === 'onboarding_version_conflict') return reply(409, { error: 'Ce dossier a été modifié dans un autre onglet. Ton brouillon est conservé : copie-le avant de recharger le dossier.' });
      if (error.reason === 'onboarding_forbidden') return reply(403, { error: 'Accès refusé.' });
      if (error.reason === 'onboarding_coaching_too_early') return reply(400, { error: 'Le premier coaching doit être planifié à partir de J+33.' });
      if (error.reason === 'onboarding_invalid_time') return reply(400, { error: 'Choisis la date et l’heure réelles du contact, pas une date future.' });
      if (error.reason === 'onboarding_command_conflict') return reply(409, { error: 'Commande déjà utilisée. Recharge le dossier.' });
      return reply(503, { error: 'CRM momentanément indisponible ou tables non installées. Rien n’a été envoyé au client. Réessaie dans un instant.' });
    }
  };
}
export default createHandler();
