import { createClient } from '@supabase/supabase-js';
import { coachingUrl } from './coaching-routes.js';

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL || 'https://skomdzfwenlrzsjsjyqu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_toQ5q4YbxTOG8MRX1U7EXw_ilshC2Ov';

export const coachingSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const roleDestinations = {
  owner: coachingUrl('/coaching/admin'),
  coach: coachingUrl('/coach-console'),
  client: coachingUrl('/coaching/eleve'),
  student: coachingUrl('/coaching/eleve'),
};

export function isLocalCoachingPreview() {
  const local = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  const params = new URLSearchParams(window.location.search);
  return local && !params.has('live');
}
export async function getCoachingMembership(userId) {
  const { data, error } = await coachingSupabase
    .from('coaching_memberships')
    .select('user_id,role,active')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function routeAuthenticatedUser(session) {
  const membership = await getCoachingMembership(session.user.id);
  const destination = roleDestinations[membership?.role];
  if (!destination) throw new Error('Ton compte existe, mais aucun rôle coaching actif ne lui est encore attribué.');
  window.location.href = destination;
}

export async function requireCoachingRole(expectedRole) {
  if (isLocalCoachingPreview()) return { mode: 'demo', session: null, membership: { role: expectedRole } };
  const { data: { session }, error } = await coachingSupabase.auth.getSession();
  if (error || !session) {
    window.location.replace(coachingUrl('/coaching'));
    return null;
  }
  const membership = await getCoachingMembership(session.user.id);
  if (!membership) {
    await coachingSupabase.auth.signOut();
    window.location.replace(coachingUrl('/coaching?error=role'));
    return null;
  }
  if (expectedRole && membership.role !== expectedRole) {
    window.location.replace(roleDestinations[membership.role] || coachingUrl('/coaching'));
    return null;
  }
  return { mode: 'live', session, membership };
}

export async function signOutCoaching() {
  await coachingSupabase.auth.signOut();
  window.location.href = coachingUrl('/coaching');
}

export function friendlyAuthError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.';
  if (message.includes('email not confirmed')) return 'Ton adresse email doit encore être confirmée.';
  if (message.includes('rate limit')) return 'Trop de tentatives. Attends quelques minutes puis réessaie.';
  if (message.includes('failed to fetch')) return 'Connexion impossible pour le moment. Vérifie ta connexion internet.';
  return error?.message || 'Une erreur empêche la connexion pour le moment.';
}
