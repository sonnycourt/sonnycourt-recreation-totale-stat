import { formatDateTime, getDemoState, setDemoSession, updateDemoState } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole } from './coaching-supabase.js';

const DURATIONS = [30, 45, 60, 90];
const params = new URLSearchParams(window.location.search);
const slotDays = document.querySelector('[data-slot-days]');
const selectionTitle = document.querySelector('[data-selection-title]');
const selectionCopy = document.querySelector('[data-selection-copy]');
const confirmButton = document.querySelector('[data-confirm-booking]');
const errorNode = document.querySelector('[data-booking-error]');
let selectedSlot = null;
let selectedDuration = 45;
let atomicSlots = [];
let balance = 0;
let mode = 'demo';
let coachName = 'Romain';

const creditsFor = (duration) => duration / 15;
const iso = (value) => new Date(value).toISOString();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

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

function clearSelection() {
  selectedSlot = null;
  document.querySelectorAll('[data-slot-id]').forEach((slot) => slot.classList.remove('active'));
  selectionTitle.textContent = 'Choisis un horaire';
  selectionCopy.textContent = 'Aucun créneau sélectionné';
  confirmButton.disabled = true;
}

function renderDuration() {
  const cost = creditsFor(selectedDuration);
  document.querySelector('[data-booking-duration]').textContent = `${selectedDuration} minutes`;
  document.querySelector('[data-booking-cost]').textContent = `${cost} crédits`;
  document.querySelector('[data-duration-hint]').textContent = `${selectedDuration} minutes utilisent ${cost} crédits.`;
  document.querySelectorAll('[data-duration]').forEach((button) => {
    const duration = Number(button.dataset.duration);
    const active = duration === selectedDuration;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
    button.disabled = creditsFor(duration) > balance;
  });
}

function validStarts() {
  const units = creditsFor(selectedDuration);
  const byStart = new Map(atomicSlots.map((slot) => [iso(slot.starts_at), slot]));
  return atomicSlots.filter((slot) => {
    const start = new Date(slot.starts_at);
    const localMinute = Number(new Intl.DateTimeFormat('fr-CH', { minute: '2-digit', timeZone: 'Europe/Zurich' }).format(start));
    if (localMinute % 30 !== 0) return false;
    for (let piece = 0; piece < units; piece += 1) {
      const atom = byStart.get(new Date(start.getTime() + piece * 15 * 60000).toISOString());
      if (!atom || new Date(atom.ends_at).getTime() - new Date(atom.starts_at).getTime() !== 15 * 60000) return false;
    }
    return true;
  });
}

function selectSlot(button) {
  document.querySelectorAll('[data-slot-id]').forEach((slot) => slot.classList.toggle('active', slot === button));
  selectedSlot = { id: button.dataset.slotId, startsAt: button.dataset.slotStart };
  selectionTitle.textContent = formatDateTime(selectedSlot.startsAt);
  selectionCopy.textContent = `${selectedDuration} minutes · ${creditsFor(selectedDuration)} crédits · Google Meet`;
  confirmButton.disabled = false;
  showError('');
}

function bindSlots() {
  document.querySelectorAll('[data-slot-id]').forEach((button) => button.addEventListener('click', () => selectSlot(button)));
}

function renderSlots() {
  clearSelection();
  const slots = validStarts();
  const days = new Map();
  for (const slot of slots) {
    const date = new Date(slot.starts_at);
    const key = date.toLocaleDateString('fr-CH', { timeZone: 'Europe/Zurich' });
    if (!days.has(key)) days.set(key, { date, slots: [] });
    days.get(key).slots.push(slot);
  }
  if (!days.size) {
    slotDays.innerHTML = `<div class="empty-state"><strong>Aucun créneau de ${selectedDuration} minutes.</strong><p>${escapeHtml(coachName)} ajoutera bientôt de nouvelles disponibilités.</p></div>`;
    return;
  }
  slotDays.innerHTML = [...days.values()].slice(0, 6).map(({ date, slots: daySlots }) => {
    const title = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });
    return `<section class="slot-day" aria-label="Disponibilités du ${escapeHtml(title)}"><h3>${escapeHtml(title[0].toUpperCase() + title.slice(1))}</h3><div class="slot-grid">${daySlots.map((slot) => {
      const time = new Date(slot.starts_at).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
      return `<button class="slot" type="button" data-slot-id="${escapeHtml(slot.id)}" data-slot-start="${escapeHtml(slot.starts_at)}">${escapeHtml(time)}</button>`;
    }).join('')}</div></section>`;
  }).join('');
  bindSlots();
}

function chooseDuration(duration) {
  if (!DURATIONS.includes(duration) || creditsFor(duration) > balance) return;
  selectedDuration = duration;
  renderDuration();
  renderSlots();
}

function createDemoAtoms() {
  const atoms = [];
  const day = new Date();
  day.setDate(day.getDate() + 1);
  day.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(day.getTime() + offset * 86400000);
    if ([0, 6].includes(date.getDay())) continue;
    for (const [startHour, startMinute, endHour, endMinute] of [[9, 30, 12, 0], [14, 0, 17, 30]]) {
      const start = new Date(date);
      start.setHours(startHour, startMinute, 0, 0);
      const end = new Date(date);
      end.setHours(endHour, endMinute, 0, 0);
      for (let cursor = start.getTime(); cursor + 15 * 60000 <= end.getTime(); cursor += 15 * 60000) {
        const startsAt = new Date(cursor).toISOString();
        atoms.push({ id: startsAt, starts_at: startsAt, ends_at: new Date(cursor + 15 * 60000).toISOString() });
      }
    }
  }
  return atoms;
}

function initializeBalance(value) {
  balance = Math.max(Number(value || 0), 0);
  if (balance < 2) {
    window.location.replace(coachingUrl('/coaching/credits?notice=insufficient'));
    return false;
  }
  if (creditsFor(selectedDuration) > balance) selectedDuration = balance >= 4 ? 60 : balance >= 3 ? 45 : 30;
  document.querySelector('[data-booking-credits]').textContent = String(balance);
  renderDuration();
  return true;
}

async function bootDemo() {
  setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
  const state = getDemoState();
  if (!initializeBalance(state.student.creditsTotal - state.student.creditsUsed)) return;
  if (!state.student.preparation.completed && !params.has('preview')) {
    window.location.replace(coachingUrl('/coaching/preparation'));
    return;
  }
  document.querySelector('[data-prep-subject]').textContent = state.student.preparation.subject || 'Sujet à préciser avec Romain';
  atomicSlots = createDemoAtoms();
  renderSlots();
}

async function bootLive(session) {
  const { data: client, error: clientError } = await coachingSupabase.from('coaching_clients').select('id,coach_id,first_name,coaching_coaches(slug,first_name,last_name,avatar_url)').eq('auth_user_id', session.user.id).single();
  if (clientError) throw clientError;
  renderCoach(client.coaching_coaches || {});
  const [balanceResult, prepResult, slotsResult] = await Promise.all([
    coachingSupabase.rpc('coaching_credit_balance', { p_client_id: client.id }),
    coachingSupabase.from('coaching_form_responses').select('answers,status').eq('client_id', client.id).eq('status', 'submitted').is('session_id', null).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    coachingSupabase.from('coaching_availability_slots').select('id,starts_at,ends_at').eq('coach_id', client.coach_id).eq('status', 'available').gte('starts_at', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()).order('starts_at').limit(500),
  ]);
  const failure = [balanceResult, prepResult, slotsResult].find((result) => result.error)?.error;
  if (failure) throw failure;
  if (!initializeBalance(balanceResult.data)) return;
  if (!prepResult.data) {
    window.location.replace(coachingUrl('/coaching/preparation'));
    return;
  }
  document.querySelector('[data-prep-subject]').textContent = prepResult.data.answers?.subject || `Sujet transmis à ${coachName}`;
  document.querySelector('[data-booking-source]').textContent = `Ces créneaux sont synchronisés avec les disponibilités réelles de ${coachName}.`;
  atomicSlots = slotsResult.data || [];
  renderSlots();
}

async function confirmDemo() {
  const cost = creditsFor(selectedDuration);
  updateDemoState((state) => {
    const isNewBooking = !state.student.nextSession;
    state.student.nextSession = selectedSlot.startsAt;
    state.student.nextSessionDuration = selectedDuration;
    if (isNewBooking) {
      state.student.creditsUsed = Math.min(state.student.creditsUsed + cost, state.student.creditsTotal);
      const client = state.clients.find((item) => item.id === state.student.id);
      if (client) client.creditsUsed = Math.min(client.creditsUsed + cost, client.creditsTotal);
    }
    const client = state.clients.find((item) => item.id === state.student.id);
    if (client) client.nextSession = formatDateTime(selectedSlot.startsAt);
    state.activity.unshift({ tone: 'green', label: 'Séance réservée', detail: `Claire · ${selectedDuration} min · ${formatDateTime(selectedSlot.startsAt)}`, time: 'À l’instant' });
    return state;
  });
}

async function confirmLive() {
  const { data: { session } } = await coachingSupabase.auth.getSession();
  if (!session) throw new Error('Ta session a expiré. Reconnecte-toi.');
  const response = await fetch('/.netlify/functions/coaching-book-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ slot_id: selectedSlot.id, duration_minutes: selectedDuration, timezone: 'Europe/Zurich' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ce créneau ne peut plus être réservé.');
  sessionStorage.setItem('coaching:last-session-id', payload.session_id || '');
}

document.querySelectorAll('[data-duration]').forEach((button) => button.addEventListener('click', () => chooseDuration(Number(button.dataset.duration))));

confirmButton.addEventListener('click', async () => {
  if (!selectedSlot) return;
  confirmButton.disabled = true;
  confirmButton.textContent = 'Confirmation…';
  try {
    if (mode === 'demo') await confirmDemo(); else await confirmLive();
    window.location.href = coachingUrl('/coaching/confirmation');
  } catch (error) {
    showError(error.message || 'Impossible de confirmer ce créneau.');
    confirmButton.disabled = false;
    confirmButton.textContent = 'Confirmer la séance';
  }
});

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

boot();
