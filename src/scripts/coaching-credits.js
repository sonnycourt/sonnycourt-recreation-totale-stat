import { clearDemoSession, getDemoState, setDemoSession } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

let mode = 'demo';
let student = null;

function safeUrl(value) {
  const url = String(value || '');
  return url.startsWith('/') || /^https:\/\//i.test(url) ? url : '';
}

function renderAvatar(url, initials) {
  document.querySelectorAll('[data-student-avatar]').forEach((node) => {
    const safe = safeUrl(url);
    node.innerHTML = safe ? `<img src="${safe}" alt="" />` : `<span>${initials}</span>`;
  });
}

function render(profile) {
  student = profile;
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Élève';
  const initials = fullName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelectorAll('[data-student-first-name]').forEach((node) => { node.textContent = profile.firstName || 'Élève'; });
  document.querySelectorAll('[data-student-full-name]').forEach((node) => { node.textContent = fullName; });
  document.querySelectorAll('[data-student-initials]').forEach((node) => { node.textContent = initials; });
  document.querySelector('[data-wallet-balance]').textContent = String(profile.balance);
  document.querySelector('[data-wallet-time]').textContent = profile.balance >= 4
    ? `${Math.floor(profile.balance / 4)} h${profile.balance % 4 ? ` ${profile.balance % 4 * 15} min` : ''}`
    : `${profile.balance * 15} min`;
  document.querySelector('[data-wallet-sessions]').textContent = String(Math.floor(profile.balance / 3));
  document.querySelector('[data-wallet-status]').textContent = profile.membership ? 'Membership actif' : 'Solde synchronisé';
  document.querySelector('[data-membership-management]')?.toggleAttribute('hidden', !profile.membership);
  renderAvatar(profile.avatarUrl, initials);
}

async function getLiveProfile(session) {
  const { data: client, error } = await coachingSupabase
    .from('coaching_clients')
    .select('id,first_name,last_name,email,avatar_url')
    .eq('auth_user_id', session.user.id)
    .single();
  if (error) throw error;
  const [balanceResult, membershipResult] = await Promise.all([
    coachingSupabase.rpc('coaching_credit_balance', { p_client_id: client.id }),
    coachingSupabase.from('coaching_subscriptions').select('id,status,current_period_end').eq('client_id', client.id).in('status', ['trialing', 'active', 'past_due']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (balanceResult.error) throw balanceResult.error;
  return {
    firstName: client.first_name,
    lastName: client.last_name,
    email: client.email,
    avatarUrl: client.avatar_url,
    balance: Math.max(Number(balanceResult.data || 0), 0),
    membership: membershipResult.error ? null : membershipResult.data,
  };
}

function toast(message) {
  const node = document.querySelector('[data-wallet-toast]');
  node.textContent = message;
  node.classList.add('is-visible');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('is-visible'), 3400);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-offer]');
  if (!button) return;
  if (mode === 'demo') return toast('Aperçu : aucun paiement ne sera déclenché.');
  window.location.href = coachingUrl(`/coaching/paiement?offer=${encodeURIComponent(button.dataset.offer)}`);
});

document.querySelector('[data-manage-membership]')?.addEventListener('click', async () => {
  if (mode === 'demo') return toast('Aperçu : le portail Stripe s’ouvrira ici.');
  const { data: { session } } = await coachingSupabase.auth.getSession();
  const response = await fetch('/.netlify/functions/coaching-stripe-portal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token || ''}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) return toast(data.error || 'Le portail Stripe est indisponible.');
  window.location.href = data.url;
});

document.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
  event.preventDefault();
  if (mode === 'demo') {
    clearDemoSession();
    window.location.href = coachingUrl('/coaching');
  } else await signOutCoaching();
});

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  mode = access.mode;
  if (mode === 'demo') {
    setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
    const demo = getDemoState().student;
    render({ firstName: demo.firstName, lastName: demo.lastName, email: demo.email, avatarUrl: demo.avatarUrl, balance: Math.max(demo.creditsTotal - demo.creditsUsed, 0), membership: demo.membership || null });
  } else {
    try { render(await getLiveProfile(access.session)); }
    catch (error) {
      console.error('coaching wallet load', error);
      toast('Le solde ne peut pas être chargé pour le moment.');
    }
  }
}

boot();
