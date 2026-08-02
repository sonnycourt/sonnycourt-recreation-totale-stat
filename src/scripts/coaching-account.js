import { clearDemoSession, getDemoSession, getDemoState, updateDemoState } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

const form = document.querySelector('[data-account-form]');
const feedback = document.querySelector('[data-account-feedback]');
const fileInput = document.getElementById('avatar-file');
let accessMode = 'demo';
let role = 'client';
let session = null;
let profile = null;
let pendingFile = null;

const destinations = {
  owner: coachingUrl('/coaching/admin'),
  coach: coachingUrl('/coach-console'),
  client: coachingUrl('/coaching/eleve'),
};
const labels = { owner: 'Propriétaire', coach: 'Coach', client: 'Élève' };

function safeAvatar(value) {
  const avatar = String(value || '');
  return avatar.startsWith('/') || /^https:\/\//i.test(avatar) || avatar.startsWith('blob:') ? avatar : '';
}

function initialsOf(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).map((part) => String(part).trim()[0]).join('').slice(0, 2).toUpperCase() || 'SC';
}

function renderAvatar(url, initials) {
  const safe = safeAvatar(url);
  document.querySelectorAll('[data-profile-avatar], [data-account-avatar]').forEach((node) => {
    node.innerHTML = safe ? `<img src="${safe}" alt="" />` : `<span>${initials}</span>`;
  });
}

function render(data) {
  profile = data;
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ') || labels[role];
  const initials = initialsOf(data.firstName, data.lastName);
  document.querySelectorAll('[data-profile-name]').forEach((node) => { node.textContent = fullName; });
  document.querySelectorAll('[data-profile-initials]').forEach((node) => { node.textContent = initials; });
  document.querySelector('[data-profile-email]').textContent = data.email || '—';
  document.querySelector('[data-profile-role]').textContent = labels[role];
  document.querySelector('[data-profile-role-label]').textContent = `Compte ${labels[role].toLowerCase()}`;
  document.querySelector('[data-profile-timezone]').textContent = data.timezone || 'Europe/Zurich';
  document.querySelectorAll('[data-back-link]').forEach((link) => { link.href = destinations[role]; });
  form.elements.namedItem('first_name').value = data.firstName || '';
  form.elements.namedItem('last_name').value = data.lastName || '';
  form.elements.namedItem('email').value = data.email || '';
  form.elements.namedItem('phone').value = data.phone || '';
  form.elements.namedItem('country').value = ['CH', 'FR', 'BE', 'CA', 'LU'].includes(data.country) ? data.country : data.country ? 'OTHER' : '';
  form.elements.namedItem('timezone').value = data.timezone || 'Europe/Zurich';
  form.elements.namedItem('avatar_url').value = data.avatarUrl || '';
  if (role === 'owner') {
    form.elements.namedItem('phone').closest('label').hidden = true;
    form.elements.namedItem('country').closest('label').hidden = true;
  }
  const provider = session?.user?.app_metadata?.provider;
  document.querySelector('[data-auth-method]').textContent = provider === 'google' ? 'Google SSO' : 'Email + mot de passe';
  renderAvatar(data.avatarUrl, initials);
}

async function loadLive() {
  const user = session.user;
  if (role === 'client') {
    const { data, error } = await coachingSupabase.from('coaching_clients').select('first_name,last_name,email,phone,country,timezone,avatar_url').eq('auth_user_id', user.id).single();
    if (error) throw error;
    return { firstName: data.first_name, lastName: data.last_name, email: data.email, phone: data.phone, country: data.country, timezone: data.timezone, avatarUrl: data.avatar_url };
  }
  if (role === 'coach') {
    const { data, error } = await coachingSupabase.from('coaching_coaches').select('first_name,last_name,email,phone,country,timezone,avatar_url').eq('auth_user_id', user.id).single();
    if (error) throw error;
    return { firstName: data.first_name, lastName: data.last_name, email: data.email || user.email, phone: data.phone, country: data.country, timezone: data.timezone, avatarUrl: data.avatar_url };
  }
  return {
    firstName: user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || 'Sonny',
    lastName: user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' '),
    email: user.email,
    timezone: user.user_metadata?.timezone || 'Europe/Zurich',
    avatarUrl: user.user_metadata?.avatar_url || '',
  };
}

async function uploadAvatar() {
  if (!pendingFile || accessMode === 'demo') return form.elements.namedItem('avatar_url').value;
  if (pendingFile.size > 5 * 1024 * 1024) throw new Error('La photo dépasse 5 Mo.');
  const extension = (pendingFile.name.split('.').pop() || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${session.user.id}/profile-${Date.now()}.${extension}`;
  const { error } = await coachingSupabase.storage.from('coaching-avatars').upload(path, pendingFile, { cacheControl: '3600', upsert: false, contentType: pendingFile.type });
  if (error) throw error;
  const { data } = coachingSupabase.storage.from('coaching-avatars').getPublicUrl(path);
  return data.publicUrl;
}

fileInput.addEventListener('change', () => {
  pendingFile = fileInput.files?.[0] || null;
  if (!pendingFile) return;
  if (!pendingFile.type.startsWith('image/')) {
    pendingFile = null;
    feedback.textContent = 'Choisis un fichier image.';
    return;
  }
  renderAvatar(URL.createObjectURL(pendingFile), initialsOf(form.elements.namedItem('first_name').value, form.elements.namedItem('last_name').value));
  feedback.textContent = 'Photo prête. Enregistre le profil pour la confirmer.';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  feedback.textContent = 'Enregistrement…';
  try {
    const draft = Object.fromEntries(new FormData(form).entries());
    const avatarUrl = await uploadAvatar();
    if (accessMode === 'demo') {
      updateDemoState((state) => {
        if (role === 'client') Object.assign(state.student, { firstName: draft.first_name, lastName: draft.last_name, phone: draft.phone, country: draft.country, timezone: draft.timezone, avatarUrl });
        if (role === 'coach') Object.assign(state.coaches[0], { name: [draft.first_name, draft.last_name].filter(Boolean).join(' '), phone: draft.phone, country: draft.country, timezone: draft.timezone, avatarUrl });
        return state;
      });
    } else if (role === 'owner') {
      const { error } = await coachingSupabase.auth.updateUser({ data: { first_name: draft.first_name, last_name: draft.last_name, full_name: [draft.first_name, draft.last_name].filter(Boolean).join(' '), timezone: draft.timezone, avatar_url: avatarUrl } });
      if (error) throw error;
    } else {
      const { error } = await coachingSupabase.rpc('coaching_update_my_profile', {
        p_first_name: draft.first_name,
        p_last_name: draft.last_name || null,
        p_phone: draft.phone || null,
        p_country: draft.country === 'OTHER' ? null : draft.country || null,
        p_timezone: draft.timezone,
        p_avatar_url: avatarUrl || null,
      });
      if (error) throw error;
    }
    pendingFile = null;
    render({ ...profile, firstName: draft.first_name, lastName: draft.last_name, phone: draft.phone, country: draft.country, timezone: draft.timezone, avatarUrl });
    feedback.textContent = 'Profil enregistré.';
  } catch (error) {
    console.error('coaching account save', error);
    feedback.textContent = error.message?.includes('Bucket') ? 'Le stockage des photos doit encore être activé dans Supabase.' : error.message || 'Enregistrement impossible pour le moment.';
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll('[data-logout]').forEach((link) => link.addEventListener('click', async (event) => {
  event.preventDefault();
  if (accessMode === 'demo') {
    clearDemoSession();
    window.location.href = coachingUrl('/coaching');
  } else await signOutCoaching();
}));

async function boot() {
  const access = await requireCoachingRole();
  if (!access) return;
  accessMode = access.mode;
  session = access.session;
  role = access.mode === 'demo'
    ? new URLSearchParams(window.location.search).get('role') || getDemoSession()?.role || 'client'
    : access.membership.role;
  if (!destinations[role]) role = 'client';
  try {
    if (accessMode === 'live') render(await loadLive());
    else {
      const state = getDemoState();
      if (role === 'owner') render({ firstName: 'Sonny', lastName: 'Court', email: state.owner.email, timezone: 'Europe/Zurich' });
      else if (role === 'coach') {
        const coach = state.coaches[0];
        const names = coach.name.split(' ');
        render({ firstName: names[0], lastName: names.slice(1).join(' '), email: coach.email, phone: coach.phone, country: coach.country, timezone: coach.timezone || 'Europe/Zurich', avatarUrl: coach.avatarUrl });
      } else {
        const student = state.student;
        render({ firstName: student.firstName, lastName: student.lastName, email: student.email, phone: student.phone, country: student.country, timezone: student.timezone || 'Europe/Zurich', avatarUrl: student.avatarUrl });
      }
    }
  } catch (error) {
    console.error('coaching account load', error);
    feedback.textContent = 'Le profil ne peut pas être chargé pour le moment.';
  }
}

boot();
