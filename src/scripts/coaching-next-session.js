import { clearDemoSession, formatDateTime, getDemoState, setDemoSession } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

let appointment = null;

function safeAvatar(value) {
  const avatar = String(value || '');
  return avatar.startsWith('/') || /^https:\/\//i.test(avatar) ? avatar : '';
}

function renderIdentity(client = {}) {
  const firstName = client.first_name || client.firstName || 'Claire';
  const lastName = client.last_name || client.lastName || 'Martin';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const initials = fullName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const avatar = safeAvatar(client.avatar_url || client.avatarUrl);
  document.querySelectorAll('[data-student-first-name]').forEach((node) => { node.textContent = firstName; });
  document.querySelectorAll('[data-student-full-name]').forEach((node) => { node.textContent = fullName; });
  document.querySelectorAll('[data-student-avatar]').forEach((node) => {
    node.innerHTML = avatar ? `<img src="${avatar}" alt="" />` : `<span>${initials}</span>`;
  });
}

function showState(name) {
  document.querySelector('[data-session-loading]').hidden = name !== 'loading';
  document.querySelector('[data-session-booked]').hidden = name !== 'booked';
  document.querySelector('[data-session-empty]').hidden = name !== 'empty';
}

function sessionMinutes(session) {
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at || start.getTime() + 45 * 60 * 1000);
  return Math.max(Math.round((end - start) / 60000), 15);
}

function renderSession(session, coach = {}, live = false) {
  appointment = session;
  const coachName = [coach.first_name || coach.firstName, coach.last_name || coach.lastName].filter(Boolean).join(' ') || 'Romain';
  const coachAvatar = safeAvatar(coach.avatar_url || coach.avatarUrl) || '/media/coachs/romain.webp?v=ai-hd';
  document.querySelector('[data-session-date]').textContent = formatDateTime(session.starts_at);
  document.querySelector('[data-session-duration]').textContent = `${sessionMinutes(session)} minutes`;
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  const image = document.querySelector('[data-coach-avatar]');
  image.src = coachAvatar;
  image.alt = coachName;

  const meetLink = document.querySelector('[data-session-meet-link]');
  const waiting = document.querySelector('[data-session-meet-waiting]');
  if (session.meet_url) {
    meetLink.href = session.meet_url;
    meetLink.hidden = false;
    waiting.hidden = true;
    document.querySelector('[data-session-top-status]').textContent = 'Lien Meet prêt';
    document.querySelector('[data-session-notice]').textContent = 'Ta salle Google Meet est prête. Tu peux l’ouvrir depuis cet appareil.';
  } else {
    meetLink.hidden = true;
    waiting.hidden = false;
    document.querySelector('[data-session-top-status]').textContent = 'Séance confirmée';
    document.querySelector('[data-session-notice]').textContent = live
      ? 'La séance est confirmée. Le bouton Meet apparaîtra ici automatiquement dès la synchronisation du calendrier.'
      : 'Compte test : le bouton deviendra actif ici dès qu’un vrai lien Google Meet existera.';
  }
  showState('booked');
}

function renderEmpty(message = '') {
  appointment = null;
  document.querySelector('[data-session-top-status]').textContent = 'À réserver';
  const copy = document.querySelector('[data-session-empty] > p:nth-of-type(2)');
  if (message && copy) copy.textContent = message;
  showState('empty');
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  if (access.mode === 'demo') {
    setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
    const state = getDemoState();
    renderIdentity(state.student);
    const coach = state.coaches.find((item) => item.id === state.student.coachId) || {};
    if (!state.student.nextSession) {
      renderEmpty('Compte test : réserve un créneau pour voir cette page passer automatiquement en mode « séance confirmée ».');
      return;
    }
    renderSession({ starts_at: state.student.nextSession, ends_at: new Date(new Date(state.student.nextSession).getTime() + 45 * 60 * 1000).toISOString(), meet_url: null }, { firstName: coach.name, avatarUrl: coach.avatarUrl }, false);
    return;
  }

  try {
    const { data: client, error: clientError } = await coachingSupabase
      .from('coaching_clients')
      .select('id,first_name,last_name,avatar_url,coach_id,coaching_coaches(first_name,last_name,avatar_url)')
      .eq('auth_user_id', access.session.user.id)
      .single();
    if (clientError) throw clientError;
    renderIdentity(client);
    const { data: nextSession, error: sessionError } = await coachingSupabase
      .from('coaching_sessions')
      .select('id,starts_at,ends_at,status,meet_url')
      .eq('client_id', client.id)
      .eq('status', 'confirmed')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!nextSession) return renderEmpty();
    renderSession(nextSession, client.coaching_coaches, true);
  } catch (error) {
    console.error('coaching next session load', error);
    renderEmpty('Impossible de charger le rendez-vous pour le moment. Réessaie dans quelques instants.');
  }
}

document.querySelector('[data-download-calendar]')?.addEventListener('click', () => {
  if (!appointment) return;
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at || start.getTime() + 45 * 60 * 1000);
  const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sonny Court//Coaching//FR', 'BEGIN:VEVENT', `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, 'SUMMARY:Séance de coaching', `DESCRIPTION:${appointment.meet_url ? `Google Meet: ${appointment.meet_url}` : 'Le lien Google Meet sera disponible dans ton espace coaching.'}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ma-prochaine-seance.ics';
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
  event.preventDefault();
  if ((await requireCoachingRole('client'))?.mode === 'demo') {
    clearDemoSession();
    window.location.href = coachingUrl('/coaching');
  } else await signOutCoaching();
});

boot();
