import { formatDateTime, getDemoState, setDemoSession } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole } from './coaching-supabase.js';

let appointment = null;

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function render(session, remaining, live) {
  appointment = session;
  const coach = session.coaching_coaches;
  const coachName = coach ? [coach.first_name, coach.last_name].filter(Boolean).join(' ') : 'Romain';
  appointment.coach_name = coachName;
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  const start = new Date(session.starts_at);
  const end = new Date(session.ends_at || start.getTime() + 60 * 60 * 1000);
  const minutes = Math.round((end - start) / 60000);
  document.querySelector('[data-confirmation-date]').textContent = formatDateTime(session.starts_at);
  document.querySelector('[data-confirmation-credits]').textContent = `${remaining} crédit${remaining > 1 ? 's' : ''}`;
  document.querySelector('[data-confirmation-duration]').textContent = `${minutes} minutes`;
  const meet = document.querySelector('[data-confirmation-meet]');
  const pending = document.querySelector('[data-confirmation-meet-pending]');
  if (session.meet_url) {
    meet.href = session.meet_url;
    meet.hidden = false;
    pending.hidden = true;
  }
  if (live) document.querySelector('[data-confirmation-notice]').textContent = session.meet_url
    ? 'Le rendez-vous et le lien Google Meet sont prêts. Tu recevras également une confirmation par email.'
    : 'La séance est bien enregistrée. Le lien Google Meet apparaîtra ici dès la synchronisation du calendrier.';
  document.querySelector('[data-cancel-session]').hidden = !live;
}

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  if (access.mode === 'demo') {
    setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
    const state = getDemoState();
    if (!state.student.nextSession) return window.location.replace(coachingUrl('/coaching/eleve'));
    const duration = Number(state.student.nextSessionDuration || 45);
    render({ starts_at: state.student.nextSession, ends_at: new Date(new Date(state.student.nextSession).getTime() + duration * 60000).toISOString(), meet_url: null }, Math.max(state.student.creditsTotal - state.student.creditsUsed, 0), false);
    return;
  }
  try {
    const { data: client, error: clientError } = await coachingSupabase.from('coaching_clients').select('id').eq('auth_user_id', access.session.user.id).single();
    if (clientError) throw clientError;
    const wantedId = sessionStorage.getItem('coaching:last-session-id');
    let query = coachingSupabase.from('coaching_sessions').select('id,starts_at,ends_at,meet_url,status,coaching_coaches(first_name,last_name)').eq('client_id', client.id).eq('status', 'confirmed').order('starts_at').limit(1);
    if (wantedId) query = query.eq('id', wantedId);
    const [{ data: booked, error: bookedError }, balanceResult] = await Promise.all([query.maybeSingle(), coachingSupabase.rpc('coaching_credit_balance', { p_client_id: client.id })]);
    if (bookedError || balanceResult.error) throw bookedError || balanceResult.error;
    if (!booked) return window.location.replace(coachingUrl('/coaching/eleve'));
    render(booked, Number(balanceResult.data || 0), true);
  } catch (error) {
    console.error('coaching confirmation load', error);
    document.querySelector('[data-confirmation-notice]').textContent = 'La réservation est enregistrée, mais son détail ne peut pas être chargé pour le moment.';
  }
}

document.querySelector('[data-download-calendar]')?.addEventListener('click', () => {
  if (!appointment) return;
  const start = new Date(appointment.starts_at);
  const end = new Date(appointment.ends_at || start.getTime() + 3600000);
  const calendar = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Sonny Court//Coaching//FR','BEGIN:VEVENT',`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:Séance de coaching avec ${appointment.coach_name || 'Romain'}`,`DESCRIPTION:${appointment.meet_url ? `Google Meet: ${appointment.meet_url}` : 'Le lien Google Meet sera ajouté à ton espace.'}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'coaching-romain.ics';
  link.click();
  URL.revokeObjectURL(url);
});

document.querySelector('[data-cancel-session]')?.addEventListener('click', async (event) => {
  if (!appointment || !window.confirm('Cette séance sera annulée, tes crédits seront rendus et tu pourras choisir un autre créneau. Continuer ?')) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Annulation…';
  const { data: { session } } = await coachingSupabase.auth.getSession();
  const response = await fetch('/.netlify/functions/coaching-cancel-session', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: appointment.id, reason: 'Reprogrammation demandée par le client' }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    document.querySelector('[data-confirmation-notice]').textContent = payload.error || 'Cette séance ne peut pas être déplacée pour le moment.';
    button.disabled = false;
    button.textContent = 'Déplacer cette séance';
    return;
  }
  sessionStorage.removeItem('coaching:last-session-id');
  window.location.href = coachingUrl('/coaching/preparation');
});

boot();
