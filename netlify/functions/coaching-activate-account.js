import crypto from 'crypto';
import { getSupabaseConfig, supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token) || password.length < 10 || password.length > 200) return json(400, { error: 'Lien ou mot de passe invalide.' });
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return json(503, { error: 'Activation temporairement indisponible.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  const found = await supabaseGet(`coaching_account_activations?token_hash=eq.${tokenHash}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id,client_id,coaching_clients(id,auth_user_id,email,first_name,last_name)&limit=1`);
  const activation = found.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (!activation) return json(410, { error: 'Ce lien a expiré ou a déjà été utilisé.' });
  const claimed = await supabasePatch('coaching_account_activations', `id=eq.${activation.id}&used_at=is.null`, { used_at: now });
  if (!claimed.ok || !Array.isArray(claimed.data) || !claimed.data[0]) return json(410, { error: 'Ce lien vient déjà d’être utilisé.' });
  const client = activation.coaching_clients;

  let userId = client.auth_user_id;
  if (userId) {
    const roleResult = await supabaseGet(`coaching_memberships?user_id=eq.${encodeURIComponent(userId)}&active=eq.true&select=role&limit=1`);
    if (!roleResult.ok) {
      await supabasePatch('coaching_account_activations', `id=eq.${activation.id}`, { used_at: null });
      return json(500, { error: 'Impossible de vérifier les droits de ce compte.' });
    }
    const currentRole = Array.isArray(roleResult.data) ? roleResult.data[0]?.role : null;
    if (currentRole && currentRole !== 'client') {
      await supabasePatch('coaching_account_activations', `id=eq.${activation.id}`, { used_at: null });
      return json(409, { error: 'Ce compte interne ne peut pas être activé comme espace élève.' });
    }
  }
  const endpoint = userId ? `${url}/auth/v1/admin/users/${userId}` : `${url}/auth/v1/admin/users`;
  const authResponse = await fetch(endpoint, {
    method: userId ? 'PUT' : 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(userId ? { password } : { email: client.email, password, email_confirm: true, user_metadata: { first_name: client.first_name, last_name: client.last_name } }),
  });
  const authData = await authResponse.json().catch(() => ({}));
  if (!authResponse.ok) {
    console.error('coaching activation auth:', authData);
    await supabasePatch('coaching_account_activations', `id=eq.${activation.id}`, { used_at: null });
    return json(500, { error: 'Impossible d’activer ton compte pour le moment.' });
  }
  userId = userId || authData.id || authData.user?.id;
  if (!userId) {
    await supabasePatch('coaching_account_activations', `id=eq.${activation.id}`, { used_at: null });
    return json(500, { error: 'Activation incomplète.' });
  }

  const clientUpdate = await supabasePatch('coaching_clients', `id=eq.${client.id}`, { auth_user_id: userId });
  if (!clientUpdate.ok || !Array.isArray(clientUpdate.data) || !clientUpdate.data[0]) {
    await supabasePatch('coaching_account_activations', `id=eq.${activation.id}`, { used_at: null });
    return json(500, { error: 'Impossible de relier ton espace à ton achat.' });
  }
  const membership = await supabasePost('coaching_memberships?on_conflict=user_id', { user_id: userId, role: 'client', active: true }, { prefer: 'resolution=merge-duplicates,return=minimal' });
  if (!membership.ok) {
    await supabasePatch('coaching_account_activations', `id=eq.${activation.id}`, { used_at: null });
    return json(500, { error: 'Ton compte existe, mais son accès coaching doit encore être finalisé.' });
  }
  return json(200, { ok: true });
};
