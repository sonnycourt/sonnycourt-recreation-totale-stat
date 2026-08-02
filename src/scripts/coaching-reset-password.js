import { coachingSupabase, friendlyAuthError } from './coaching-supabase.js';
import { coachingUrl } from './coaching-routes.js';

const form = document.querySelector('[data-reset-form]');
const feedback = document.querySelector('[data-reset-feedback]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = form.elements.namedItem('password').value;
  const confirmation = form.elements.namedItem('confirmation').value;
  if (password.length < 10) {
    feedback.textContent = 'Choisis au moins 10 caractères.';
    return;
  }
  if (password !== confirmation) {
    feedback.textContent = 'Les deux mots de passe ne correspondent pas.';
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const { error } = await coachingSupabase.auth.updateUser({ password });
  if (error) {
    feedback.textContent = friendlyAuthError(error);
    submit.disabled = false;
    return;
  }
  feedback.style.color = 'var(--cp-green)';
  feedback.textContent = 'Mot de passe enregistré. Ouverture de la connexion…';
  window.setTimeout(() => { window.location.href = coachingUrl('/coaching'); }, 900);
});
