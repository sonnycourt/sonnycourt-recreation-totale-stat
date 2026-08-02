import { coachingUrl } from './coaching-routes.js';

const form = document.querySelector('[data-activation-form]');
const feedback = document.querySelector('[data-activation-feedback]');
const token = new URLSearchParams(window.location.search).get('token') || '';

if (!token) {
  feedback.textContent = 'Ce lien d’activation est incomplet. Utilise le lien reçu par email.';
  form.querySelector('[type="submit"]').disabled = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = form.elements.namedItem('password').value;
  const confirmation = form.elements.namedItem('confirmation').value;
  if (password.length < 10) return void (feedback.textContent = 'Choisis au moins 10 caractères.');
  if (password !== confirmation) return void (feedback.textContent = 'Les deux mots de passe ne correspondent pas.');
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  feedback.textContent = 'Activation sécurisée…';
  const response = await fetch('/.netlify/functions/coaching-activate-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    feedback.textContent = payload.error || 'Ce lien ne peut plus être utilisé.';
    submit.disabled = false;
    return;
  }
  feedback.style.color = 'var(--cp-green)';
  feedback.textContent = 'Ton espace est activé. Ouverture de la connexion…';
  window.setTimeout(() => { window.location.href = coachingUrl('/coaching'); }, 900);
});
