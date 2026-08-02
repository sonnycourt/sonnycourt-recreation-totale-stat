import { coachingSupabase, friendlyAuthError, routeAuthenticatedUser } from './coaching-supabase.js';

const message = document.querySelector('[data-auth-callback-message]');

async function finishAuthentication() {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      const { error } = await coachingSupabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
    }
    const { data: { session }, error } = await coachingSupabase.auth.getSession();
    if (error || !session) throw error || new Error('Session de connexion introuvable.');
    message.textContent = 'Compte reconnu. Ouverture de ton espace…';
    await routeAuthenticatedUser(session);
  } catch (error) {
    message.textContent = friendlyAuthError(error);
    message.style.color = 'var(--cp-red)';
    document.querySelector('[data-auth-back]').hidden = false;
  }
}

finishAuthentication();
