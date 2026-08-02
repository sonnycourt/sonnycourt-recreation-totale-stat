import { formatDateTime, getDemoState, setDemoSession, updateDemoState } from './coaching-demo-store.js';
import { coachingSupabase, requireCoachingRole } from './coaching-supabase.js';

const params = new URLSearchParams(window.location.search);
const slotDays = document.querySelector('[data-slot-days]');
const selectionTitle = document.querySelector('[data-selection-title]');
const selectionCopy = document.querySelector('[data-selection-copy]');
const confirmButton = document.querySelector('[data-confirm-booking]');
const errorNode = document.querySelector('[data-booking-error]');
let selectedSlot = null;
let mode = 'demo';
let coachName = 'Romain';

function renderCoach(coach = {}) {
  coachName = [coach.first_name, coach.last_name].filter(Boolean).join(' ') || 'Romain';
  const avatar = String(coach.avatar_url || '/media/coachs/romain.webp?v=ai-hd');
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  document.querySelectorAll('[data-coach-avatar]').forEach((image) => {
    image.src = avatar.startsWith('/') || /^https:\/\//i.test(avatar) ? avatar : '/favicon.svg';
    image.alt = coachName;
  });
}

function showError(message) {
  errorNode.textContent = message;
  errorNode.hidden = !message;
}

function selectSlot(button) {
  document.querySelectorAll('[data-slot-id]').forEach((slot) => slot.classList.toggle('active', slot === button));
  selectedSlot = { id: button.dataset.slotId, startsAt: button.dataset.slotStart };
  selectionTitle.textContent = formatDateTime(selectedSlot.startsAt);
  selectionCopy.textContent = '60 minutes · Google Meet · Europe/Zurich';
  confirmButton.disabled = false;
  showError('');
}

function bindSlots() {
  document.querySelectorAll('[data-slot-id]').forEach((button) => button.addEventListener('click', () => selectSlot(button)));
}

function renderLiveSlots(slots) {
  const days = new Map();
  for (const slot of slots) {
    const date = new Date(slot.starts_at);
    const key = date.toLocaleDateString('fr-CH', { timeZone: 'Europe/Zurich' });
    if (!days.has(key)) days.set(key, { date, slots: [] });
    days.get(key).slots.push(slot);
  }
  if (!days.size) {
    slotDays.innerHTML = `<div class="empty-state"><strong>Aucun créneau ouvert.</strong><p>${coachName} ajoutera bientôt de nouvelles disponibilités.</p></div>`;
    return;
  }
  slotDays.innerHTML = [...days.values()].map(({ date, slots: daySlots }) => {
    const title = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
    return `<section class="slot-day" aria-label="Disponibilités du ${title}"><h3>${title[0].toUpperCase()}${title.slice(1)}</h3><div class="slot-grid">${daySlots.map((slot) => {
      const time = new Date(slot.starts_at).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
      return `<button class="slot" type="button" data-slot-id="${slot.id}" data-slot-start="${slot.starts_at}">${time}</button>`;
    }).join('')}</div></section>`;
  }).join('');
  bindSlots();
}

async function bootDemo() {
  setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
  const state = getDemoState();
  const remaining = Math.max(state.student.creditsTotal - state.student.creditsUsed, 0);
  if (remaining <= 0) {
    window.location.replace(`/coach-romain/continuer?prenom=${encodeURIComponent(state.student.firstName)}`);
    return;
  }
  if (!state.student.preparation.completed && !params.has('preview')) {
    window.location.replace('/coaching/preparation');
    return;
  }
  document.querySelector('[data-booking-credits]').textContent = String(remaining);
  document.querySelector('[data-prep-subject]').textContent = state.student.preparation.subject || 'Sujet à préciser avec Romain';
  document.querySelectorAll('[data-slot]').forEach((button) => {
    button.dataset.slotId = button.dataset.slot;
    button.dataset.slotStart = button.dataset.slot;
  });
  bindSlots();
}

async function bootLive(session) {
  const { data: client, error: clientError } = await coachingSupabase.from('coaching_clients').select('id,coach_id,first_name,coaching_coaches(slug,first_name,last_name,avatar_url)').eq('auth_user_id', session.user.id).single();
  if (clientError) throw clientError;
  renderCoach(client.coaching_coaches || {});
  const [balanceResult, prepResult, slotsResult] = await Promise.all([
    coachingSupabase.rpc('coaching_credit_balance', { p_client_id: client.id }),
    coachingSupabase.from('coaching_form_responses').select('answers,status').eq('client_id', client.id).eq('status', 'submitted').is('session_id', null).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    coachingSupabase.from('coaching_availability_slots').select('id,starts_at,ends_at').eq('coach_id', client.coach_id).eq('status', 'available').gte('starts_at', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()).order('starts_at').limit(30),
  ]);
  const failure = [balanceResult, prepResult, slotsResult].find((result) => result.error)?.error;
  if (failure) throw failure;
  const remaining = Number(balanceResult.data || 0);
  if (remaining <= 0) {
    window.location.replace(`/coach-romain/continuer?prenom=${encodeURIComponent(client.first_name)}`);
    return;
  }
  if (!prepResult.data) {
    window.location.replace('/coaching/preparation');
    return;
  }
  document.querySelector('[data-booking-credits]').textContent = String(remaining);
  document.querySelector('[data-prep-subject]').textContent = prepResult.data.answers?.subject || `Sujet transmis à ${coachName}`;
  document.querySelector('[data-booking-source]').textContent = `Ces créneaux sont synchronisés avec les disponibilités réelles de ${coachName}.`;
  renderLiveSlots(slotsResult.data || []);
}

async function confirmDemo() {
  updateDemoState((state) => {
    const isNewBooking = !state.student.nextSession;
    state.student.nextSession = selectedSlot.startsAt;
    if (isNewBooking) {
      state.student.creditsUsed = Math.min(state.student.creditsUsed + 1, state.student.creditsTotal);
      const client = state.clients.find((item) => item.id === state.student.id);
      if (client) client.creditsUsed = Math.min(client.creditsUsed + 1, client.creditsTotal);
    }
    const client = state.clients.find((item) => item.id === state.student.id);
    if (client) client.nextSession = formatDateTime(selectedSlot.startsAt);
    state.activity.unshift({ tone: 'green', label: 'Séance réservée', detail: `Claire · ${formatDateTime(selectedSlot.startsAt)}`, time: 'À l’instant' });
    return state;
  });
}

async function confirmLive() {
  const { data: { session } } = await coachingSupabase.auth.getSession();
  if (!session) throw new Error('Ta session a expiré. Reconnecte-toi.');
  const response = await fetch('/.netlify/functions/coaching-book-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ slot_id: selectedSlot.id, timezone: 'Europe/Zurich' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ce créneau ne peut plus être réservé.');
  sessionStorage.setItem('coaching:last-session-id', payload.session_id || '');
}

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  mode = access.mode;
  try {
    if (mode === 'demo') await bootDemo();
    else await bootLive(access.session);
  } catch (error) {
    console.error('coaching booking load', error);
    showError('Impossible de charger les disponibilités pour le moment.');
  }
}

confirmButton.addEventListener('click', async () => {
  if (!selectedSlot) return;
  confirmButton.disabled = true;
  confirmButton.textContent = 'Confirmation…';
  try {
    if (mode === 'demo') await confirmDemo(); else await confirmLive();
    window.location.href = '/coaching/confirmation';
  } catch (error) {
    showError(error.message || 'Impossible de confirmer ce créneau.');
    confirmButton.disabled = false;
    confirmButton.textContent = 'Confirmer la séance';
  }
});

boot();
