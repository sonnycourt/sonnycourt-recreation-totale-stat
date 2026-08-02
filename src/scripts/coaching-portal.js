import { getDemoSession, setDemoSession } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import {
  coachingSupabase,
  friendlyAuthError,
  getCoachingMembership,
  isLocalCoachingPreview,
  roleDestinations,
  routeAuthenticatedUser,
} from './coaching-supabase.js';

const form = document.querySelector('[data-login-form]');
const emailInput = document.querySelector('[data-login-email]');
const passwordInput = document.querySelector('[data-login-password]');
const feedback = document.querySelector('[data-login-feedback]');
const roleCards = document.querySelectorAll('[data-demo-role]');
const demoMode = isLocalCoachingPreview();
const statusBadge = document.querySelector('.login-panel .cp-status');
if (statusBadge && !demoMode) {
  statusBadge.textContent = 'Connexion sécurisée';
  statusBadge.classList.remove('amber');
}

const demoDestinations = {
  owner: coachingUrl('/coaching/admin?preview=1'),
  coach: coachingUrl('/coach-console?preview=1'),
  student: coachingUrl('/coaching/eleve?preview=1'),
};

function showFeedback(message, error = false) {
  feedback.hidden = false;
  feedback.textContent = message;
  feedback.style.color = error ? 'var(--cp-red)' : 'var(--cp-green)';
}

function openDemoRole(role, profile = {}) {
  setDemoSession(role, profile);
  window.location.href = demoDestinations[role] || demoDestinations.student;
}

document.querySelectorAll('[data-demo-only]').forEach((node) => { node.hidden = !demoMode; });

roleCards.forEach((button) => {
  button.addEventListener('click', () => openDemoRole(button.dataset.demoRole, {
    name: button.dataset.demoName || '',
    email: button.dataset.demoEmail || '',
  }));
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  if (!email || !password) {
    showFeedback('Entre ton email et ton mot de passe.', true);
    return;
  }

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  showFeedback('Connexion en cours…');
  try {
    if (demoMode) {
      const role = email.includes('sonny') ? 'owner' : email.includes('romain') ? 'coach' : 'student';
      window.setTimeout(() => openDemoRole(role, { email }), 300);
      return;
    }
    const { data, error } = await coachingSupabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await routeAuthenticatedUser(data.session);
  } catch (error) {
    showFeedback(friendlyAuthError(error), true);
    submit.disabled = false;
  }
});

document.querySelector('[data-google-login]')?.addEventListener('click', async () => {
  if (demoMode) {
    showFeedback('En local, utilise les profils de démonstration. Ajoute ?live=1 pour tester Google réellement.', false);
    return;
  }
  const { error } = await coachingSupabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${coachingUrl('/coaching/auth/callback')}`,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) showFeedback(friendlyAuthError(error), true);
});

document.querySelector('[data-forgot-password]')?.addEventListener('click', async () => {
  const email = emailInput.value.trim().toLowerCase();
  if (!email) {
    showFeedback('Entre d’abord ton adresse email.', true);
    emailInput.focus();
    return;
  }
  if (demoMode) {
    showFeedback('La récupération réelle est disponible avec ?live=1.', false);
    return;
  }
  const { error } = await coachingSupabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${coachingUrl('/coaching/reset-password')}`,
  });
  showFeedback(error ? friendlyAuthError(error) : 'Un email de réinitialisation vient d’être envoyé.', Boolean(error));
});

async function offerResume() {
  const resume = document.querySelector('[data-resume-session]');
  if (!resume) return;
  if (demoMode) {
    const session = getDemoSession();
    if (!session || !demoDestinations[session.role]) return;
    resume.hidden = false;
    resume.textContent = session.role === 'owner' ? 'Reprendre la vue propriétaire' : session.role === 'coach' ? 'Reprendre l’espace de Romain' : 'Reprendre mon espace élève';
    resume.addEventListener('click', () => { window.location.href = demoDestinations[session.role]; });
    return;
  }
  const { data: { session } } = await coachingSupabase.auth.getSession();
  if (!session) return;
  try {
    const membership = await getCoachingMembership(session.user.id);
    if (!membership || !roleDestinations[membership.role]) return;
    resume.hidden = false;
    resume.textContent = 'Reprendre mon espace';
    resume.addEventListener('click', () => { window.location.href = roleDestinations[membership.role]; });
  } catch {}
}

const urlError = new URLSearchParams(window.location.search).get('error');
if (urlError === 'role') showFeedback('Ce compte n’a pas encore de rôle coaching actif. Contacte Sonny.', true);
offerResume();
