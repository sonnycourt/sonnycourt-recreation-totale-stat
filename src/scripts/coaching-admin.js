import { clearDemoSession, getDemoState, resetDemoState, setDemoSession } from './coaching-demo-store.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}


function safeAvatar(value) {
  const avatar = String(value || '');
  return avatar.startsWith('/') || /^https:\/\//i.test(avatar) ? avatar : '/favicon.svg';
}

function render(state, live = false) {
  const activeClients = state.clients.filter((client) => client.status === 'active');
  const sessionsRemaining = state.clients.reduce((sum, client) => sum + Math.max(Number(client.remaining || 0), 0), 0);

  document.querySelector('[data-admin-active-clients]').textContent = String(activeClients.length);
  document.querySelector('[data-admin-credits]').textContent = String(sessionsRemaining);
  document.querySelector('[data-admin-coaches]').textContent = String(state.coaches.filter((coach) => coach.status === 'active').length);
  document.querySelector('[data-admin-revenue]').textContent = euro.format(state.revenueCents / 100);
  const infraStatus = document.querySelector('[data-infra-status]');
  if (infraStatus) {
    infraStatus.textContent = live ? 'Supabase connecté' : 'Mode local';
    infraStatus.classList.toggle('amber', !live);
  }

  document.querySelector('[data-coach-rows]').innerHTML = state.coaches.map((coach) => `
    <tr>
      <td><div class="coach-cell"><img src="${escapeHtml(safeAvatar(coach.avatarUrl))}" alt=""><span><strong>${escapeHtml(coach.name)}</strong><small>${escapeHtml(coach.email || 'Email à renseigner')}</small></span></div></td>
      <td><span class="state-pill">${coach.status === 'active' ? 'Actif' : escapeHtml(coach.status)}</span></td>
      <td>${Number(coach.activeClients || 0)} clients</td>
      <td>${Number(coach.sessionsThisMonth || 0)} séances</td>
      <td>${coach.satisfaction ? `${escapeHtml(coach.satisfaction)}/10` : '—'}</td>
      <td><a class="action-link" href="${live ? '#coachs' : '/coach-console?preview=1'}">${live ? 'Activité' : 'Ouvrir son espace'}</a></td>
    </tr>
  `).join('');

  document.querySelector('[data-client-rows]').innerHTML = state.clients.map((client) => `
    <tr>
      <td><div class="coach-cell"><span class="role-avatar student">${escapeHtml(client.initials)}</span><span><strong>${escapeHtml(client.name)}</strong><small>${escapeHtml(client.email)}</small></span></div></td>
      <td>${escapeHtml(client.plan || 'Aucune formule')}</td>
      <td>${Number(client.remaining || 0)} crédit${Number(client.remaining || 0) > 1 ? 's' : ''}</td>
      <td>${escapeHtml(client.nextSession || 'À réserver')}</td>
      <td><a class="action-link" href="${live ? '#clients' : client.id === 'claire' ? '/coaching/eleve?preview=1' : '/coach-console?preview=1#clients'}">Voir</a></td>
    </tr>
  `).join('');

  document.querySelector('[data-admin-activity]').innerHTML = state.activity.map((item) => `
    <div class="activity-item">
      <span class="${escapeHtml(item.tone || 'blue')}"><svg class="cp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg></span>
      <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div>
      <time>${escapeHtml(item.time)}</time>
    </div>
  `).join('');
}

function demoState() {
  const state = getDemoState();
  return {
    coaches: state.coaches,
    clients: state.clients.map((client) => ({
      ...client,
      initials: client.name.split(' ').map((part) => part[0]).join('').slice(0, 2),
      remaining: Math.max(client.creditsTotal - client.creditsUsed, 0),
    })),
    activity: state.activity,
    revenueCents: 328400,
  };
}

async function liveState() {
  const nowIso = new Date().toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [coachesResult, clientsResult, engagementsResult, offersResult, creditsResult, sessionsResult, activityResult, ordersResult] = await Promise.all([
    coachingSupabase.from('coaching_coaches').select('id,slug,first_name,last_name,email,avatar_url,status'),
    coachingSupabase.from('coaching_clients').select('id,first_name,last_name,email,status,coach_id'),
    coachingSupabase.from('coaching_engagements').select('id,client_id,offer_id,status,started_at').eq('status', 'active').order('started_at', { ascending: false }),
    coachingSupabase.from('coaching_offers').select('id,name,sessions_count'),
    coachingSupabase.from('coaching_credit_ledger').select('client_id,quantity'),
    coachingSupabase.from('coaching_sessions').select('client_id,coach_id,starts_at,status').order('starts_at', { ascending: true }),
    coachingSupabase.from('coaching_activity_log').select('event_type,client_id,metadata,created_at').order('created_at', { ascending: false }).limit(12),
    coachingSupabase.from('coaching_orders').select('amount_cents,status').eq('status', 'paid'),
  ]);
  const error = [coachesResult, clientsResult, engagementsResult, offersResult, creditsResult, sessionsResult, activityResult, ordersResult].find((result) => result.error)?.error;
  if (error) throw error;

  const clients = clientsResult.data || [];
  const engagements = engagementsResult.data || [];
  const offers = new Map((offersResult.data || []).map((offer) => [offer.id, offer]));
  const creditBalance = new Map();
  (creditsResult.data || []).forEach((entry) => creditBalance.set(entry.client_id, (creditBalance.get(entry.client_id) || 0) + Number(entry.quantity || 0)));
  const futureSessions = (sessionsResult.data || []).filter((item) => item.status === 'confirmed' && item.starts_at >= nowIso);

  const normalizedClients = clients.map((client) => {
    const engagement = engagements.find((item) => item.client_id === client.id);
    const offer = engagement ? offers.get(engagement.offer_id) : null;
    const next = futureSessions.find((item) => item.client_id === client.id);
    const name = [client.first_name, client.last_name].filter(Boolean).join(' ');
    return {
      id: client.id,
      name,
      initials: name.split(' ').map((part) => part[0]).join('').slice(0, 2),
      email: client.email,
      status: client.status,
      plan: offer?.name,
      remaining: creditBalance.get(client.id) || 0,
      nextSession: next ? dateTime.format(new Date(next.starts_at)) : 'À réserver',
    };
  });

  const normalizedCoaches = (coachesResult.data || []).map((coach) => ({
    id: coach.id,
    name: [coach.first_name, coach.last_name].filter(Boolean).join(' '),
    email: coach.email,
    avatarUrl: coach.avatar_url,
    status: coach.status,
    activeClients: clients.filter((client) => client.coach_id === coach.id && client.status === 'active').length,
    sessionsThisMonth: (sessionsResult.data || []).filter((session) => session.coach_id === coach.id && new Date(session.starts_at) >= monthStart).length,
    satisfaction: null,
  }));

  const clientNames = new Map(normalizedClients.map((client) => [client.id, client.name]));
  const eventLabels = {
    'session.booked': 'Séance réservée',
    'session.cancelled': 'Séance annulée',
    'order.paid': 'Paiement confirmé',
    'form.submitted': 'Préparation complétée',
  };
  const activity = (activityResult.data || []).map((item) => ({
    tone: item.event_type.includes('order') ? 'green' : item.event_type.includes('cancel') ? 'amber' : 'blue',
    label: eventLabels[item.event_type] || item.event_type,
    detail: clientNames.get(item.client_id) || 'Activité coaching',
    time: dateTime.format(new Date(item.created_at)),
  }));

  return {
    coaches: normalizedCoaches,
    clients: normalizedClients,
    activity,
    revenueCents: (ordersResult.data || []).reduce((sum, order) => sum + Number(order.amount_cents || 0), 0),
  };
}

async function boot() {
  const access = await requireCoachingRole('owner');
  if (!access) return;
  if (access.mode === 'demo') {
    setDemoSession('owner', { name: 'Sonny', email: 'sonnycourt@gmail.com' });
    document.querySelectorAll('[data-demo-link]').forEach((link) => { link.href = link.dataset.demoLink; });
    render(demoState(), false);
  } else {
    document.querySelector('[data-reset-demo]')?.closest('.sidebar-foot')?.querySelector('[data-reset-demo]')?.setAttribute('hidden', '');
    try { render(await liveState(), true); }
    catch (error) {
      console.error('coaching admin load', error);
      document.querySelector('[data-infra-status]').textContent = 'Configuration requise';
    }
  }
}

document.querySelector('[data-reset-demo]')?.addEventListener('click', (event) => {
  event.preventDefault();
  resetDemoState();
  render(demoState(), false);
  const button = event.currentTarget;
  const original = button.textContent;
  button.textContent = 'Maquette réinitialisée';
  window.setTimeout(() => { button.textContent = original; }, 1400);
});

document.querySelector('[data-logout]')?.addEventListener('click', async (event) => {
  event.preventDefault();
  if ((await requireCoachingRole('owner'))?.mode === 'demo') {
    clearDemoSession();
    window.location.href = '/coaching';
  } else await signOutCoaching();
});

boot();
