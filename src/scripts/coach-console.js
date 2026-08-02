import { clearDemoSession, formatDateTime, getDemoState } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole, signOutCoaching } from './coaching-supabase.js';

const clients = {
  claire: {
    id: 'claire',
    initials: 'CM',
    avatar: 'avatar-claire',
    name: 'Claire Martin',
    email: 'claire.martin@example.com',
    phone: '+33 6 00 00 00 01',
    type: 'Première consultation',
    status: 'Nouveau dossier',
    next: 'Aujourd’hui · 14:00',
    objective: 'Prendre une décision professionnelle sans agir depuis la peur.',
    context: 'Claire hésite entre rester dans un poste devenu trop étroit et lancer une activité indépendante. Elle veut sortir de la boucle mentale et repartir avec une décision praticable.',
    preparation: 'Je tourne en boucle entre deux directions professionnelles depuis plusieurs mois. Je veux comprendre ce qui est vraiment juste pour moi et arrêter de décider depuis la peur.',
    focus: 'Prendre une décision',
    journey: 'Suit Esprit Subconscient 2.0 depuis 4 mois',
    sessions: [
      { title: 'Première consultation', date: 'Aujourd’hui · 14:00', status: 'À venir' },
    ],
    commitments: ['Nommer le coût réel de chaque option', 'Choisir un critère de décision avant l’appel'],
    credits: 6,
  },
  thomas: {
    id: 'thomas', initials: 'TR', avatar: 'avatar-thomas', name: 'Thomas Rey',
    email: 'thomas.rey@example.com', phone: '+41 79 000 00 02', type: 'Suivi premium · 3/6',
    status: 'Actif', next: 'Aujourd’hui · 16:30',
    objective: 'Stabiliser une nouvelle identité et maintenir le passage à l’action.',
    context: 'Thomas progresse vite lorsqu’une action est claire, puis perd son élan quand les résultats tardent. Le travail actuel porte sur la constance sans recherche de validation immédiate.',
    preparation: 'Cette semaine, j’ai tenu mes engagements quatre jours sur sept. Je veux comprendre ce qui me fait encore décrocher dès que je doute.',
    focus: 'Consolider la constance', journey: 'Parcours premium · commencé le 8 juillet',
    sessions: [
      { title: 'Séance 3 · Constance', date: 'Aujourd’hui · 16:30', status: 'À venir' },
      { title: 'Séance 2 · Identité', date: '23 juillet · 11:00', status: 'Terminée' },
      { title: 'Séance 1 · Direction', date: '10 juillet · 11:00', status: 'Terminée' },
    ],
    commitments: ['Rituel de 12 minutes chaque matin', 'Mesurer les répétitions, pas les résultats'],
    credits: 9,
  },
  sarah: {
    id: 'sarah', initials: 'SD', avatar: 'avatar-sarah', name: 'Sarah Dubois',
    email: 'sarah.dubois@example.com', phone: '+33 6 00 00 00 03', type: 'Suivi premium · 6/6',
    status: 'Bilan à préparer', next: '4 août · 10:00',
    objective: 'Décider de la suite après six séances et formaliser les acquis.',
    context: 'Sarah termine son premier cycle. Le changement principal est sa capacité à poser des limites sans se justifier. La prochaine séance doit rendre ses progrès visibles et définir la suite.',
    preparation: 'Je veux faire le point sur ce qui a réellement changé et savoir si j’ai besoin d’un autre cycle ou si je peux continuer seule.',
    focus: 'Faire un bilan honnête', journey: 'Parcours premium · cycle presque terminé',
    sessions: [
      { title: 'Séance 6 · Bilan', date: '4 août · 10:00', status: 'À venir' },
      { title: 'Séance 5 · Limites', date: '21 juillet · 10:00', status: 'Terminée' },
      { title: 'Séance 4 · Validation', date: '7 juillet · 10:00', status: 'Terminée' },
    ],
    commitments: ['Écrire les trois changements les plus concrets', 'Choisir les situations encore fragiles'],
    credits: 3,
  },
  manon: {
    id: 'manon', initials: 'ML', avatar: 'avatar-manon', name: 'Manon Lefèvre',
    email: 'manon.lefevre@example.com', phone: '+33 6 00 00 00 04', type: 'Suivi premium · 1/6',
    status: 'Note ouverte', next: '5 août · 16:30',
    objective: 'Sortir de la comparaison et créer un plan d’intégration réaliste.',
    context: 'Première séance réalisée hier. Manon identifie bien son schéma de comparaison mais a tendance à transformer chaque prise de conscience en nouvelle exigence.',
    preparation: 'Je veux arrêter de perdre mon énergie à regarder où en sont les autres et construire quelque chose qui me ressemble.',
    focus: 'Revenir à son propre rythme', journey: 'Parcours premium · intégration',
    sessions: [
      { title: 'Séance 2 · Intégration', date: '5 août · 16:30', status: 'À venir' },
      { title: 'Séance 1 · Comparaison', date: '31 juillet · 16:30', status: 'Note ouverte' },
    ],
    commitments: ['Supprimer deux sources de comparaison pendant 7 jours', 'Définir sa propre mesure de progrès'],
  },
  julien: {
    id: 'julien', initials: 'JP', avatar: 'avatar-julien', name: 'Julien Perrin',
    email: 'julien.perrin@example.com', phone: '+33 6 00 00 00 05', type: 'Suivi en pause',
    status: 'À relancer', next: 'Non planifiée',
    objective: 'Reprendre le parcours ou fermer proprement le cycle.',
    context: 'Julien a demandé une pause après quatre séances pour une période professionnelle intense. Aucun retour depuis sept jours après la date de reprise envisagée.',
    preparation: 'Aucune nouvelle préparation reçue.',
    focus: 'Clarifier la reprise', journey: '4 séances réalisées · pause depuis le 18 juillet',
    sessions: [
      { title: 'Séance 4 · Priorités', date: '18 juillet · 14:30', status: 'Terminée' },
      { title: 'Séance 3 · Limites', date: '4 juillet · 14:30', status: 'Terminée' },
    ],
    commitments: ['Répondre sur sa capacité réelle à reprendre', 'Ne pas prolonger une pause indéfinie'],
  },
  nora: {
    id: 'nora', initials: 'NB', avatar: 'avatar-nora', name: 'Nora Benali',
    email: 'nora.benali@example.com', phone: '+33 6 00 00 00 06', type: 'Première consultation',
    status: 'Questionnaire attendu', next: '7 août · 11:00',
    objective: 'À préciser avec le questionnaire de préparation.',
    context: 'Réservation payée. Le questionnaire post-paiement n’a pas encore été complété.',
    preparation: 'En attente de la cliente.',
    focus: 'À définir', journey: 'Nouvelle cliente · source : email',
    sessions: [
      { title: 'Première consultation', date: '7 août · 11:00', status: 'À venir' },
    ],
    commitments: ['Compléter le questionnaire avant la séance'],
  },
  emma: {
    id: 'emma', initials: 'EV', avatar: 'avatar-emma', name: 'Emma Vidal',
    email: 'emma.vidal@example.com', phone: '+33 6 00 00 00 07', type: 'Première consultation',
    status: 'Préparation reçue', next: '3 août · 09:30',
    objective: 'Retrouver une direction après une période de transition.',
    context: 'Emma arrive par recommandation. Elle cherche une structure claire pour traverser un changement de vie sans se précipiter.',
    preparation: 'Je veux retrouver une direction et ne plus choisir uniquement pour rassurer mon entourage.',
    focus: 'Retrouver une direction', journey: 'Nouvelle cliente · recommandation',
    sessions: [{ title: 'Première consultation', date: '3 août · 09:30', status: 'À venir' }],
    commitments: ['Lister les décisions qu’elle reporte actuellement'],
  },
};

function syncClaireClientFromDemo() {
  const demoStudent = getDemoState().student;
  const claire = clients.claire;
  if (!demoStudent || !claire) return;
  const bookedNumber = Math.max(demoStudent.creditsUsed, 1);
  claire.email = demoStudent.email;
  claire.type = `${demoStudent.plan} · séance ${bookedNumber}/${demoStudent.creditsTotal}`;
  claire.status = demoStudent.nextSession ? 'Séance confirmée' : demoStudent.preparation.completed ? 'Préparation reçue' : 'Préparation attendue';
  claire.next = demoStudent.nextSession ? formatDateTime(demoStudent.nextSession) : 'À réserver';
  claire.objective = demoStudent.objective;
  claire.preparation = demoStudent.preparation.subject || 'Préparation en attente.';
  claire.focus = demoStudent.preparation.outcome || 'Préciser le résultat attendu';
  claire.journey = `${demoStudent.plan} · ${Math.max(demoStudent.creditsTotal - demoStudent.creditsUsed, 0)} crédit(s) restant(s)`;
  claire.credits = Math.max(demoStudent.creditsTotal - demoStudent.creditsUsed, 0);
  claire.context = [demoStudent.preparation.progress, demoStudent.preparation.obstacle, demoStudent.preparation.context].filter(Boolean).join(' ')
    || claire.context;
  claire.commitments = [demoStudent.preparation.outcome || 'Définir une décision utile', 'Choisir la première action à réaliser'].filter(Boolean);
  if (demoStudent.nextSession) {
    claire.sessions = [
      { title: `Séance ${bookedNumber} · Suivi`, date: formatDateTime(demoStudent.nextSession), status: 'À venir' },
      ...demoStudent.history.map((item) => ({ title: item.label, date: item.date, status: item.status })),
    ];
  }
}

function syncClaireDashboardFromDemo() {
  syncClaireClientFromDemo();
  const demoStudent = getDemoState().student;
  const card = document.querySelector('.next-session');
  if (!card || !demoStudent) return;
  const description = card.querySelector('.session-person > div:nth-child(2) p');
  const preparationStatus = card.querySelector('.session-person > div:nth-child(2) span');
  const day = card.querySelector('.session-time small');
  const time = card.querySelector('.session-time strong');
  const priority = card.querySelector('.prep-grid > div:first-child p');
  const contextList = card.querySelector('.prep-grid > div:nth-child(2) ul');
  const cardEyebrow = card.querySelector('.card-heading .eyebrow');
  const date = demoStudent.nextSession ? new Date(demoStudent.nextSession) : null;
  const remaining = Math.max(demoStudent.creditsTotal - demoStudent.creditsUsed, 0);

  if (description) description.textContent = `${demoStudent.plan} · séance ${Math.max(demoStudent.creditsUsed, 1)}/${demoStudent.creditsTotal}`;
  if (preparationStatus) preparationStatus.innerHTML = `<i></i> ${demoStudent.preparation.completed ? 'Préparation complétée' : 'Préparation attendue'}`;
  if (priority) priority.textContent = `« ${demoStudent.preparation.subject || demoStudent.objective} »`;
  if (contextList) {
    const items = [
      demoStudent.preparation.progress || 'Parcours commencé avec Romain',
      demoStudent.preparation.obstacle || 'Obstacle à préciser en séance',
      `${remaining} crédit${remaining > 1 ? 's' : ''} après cette réservation`,
    ];
    contextList.innerHTML = items.map((item) => `<li>${item}</li>`).join('');
  }
  if (date) {
    if (cardEyebrow) cardEyebrow.textContent = 'Prochaine séance confirmée';
    if (day) day.textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Zurich' }).format(date);
    if (time) time.textContent = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(date);
  }
}

const viewMeta = {
  dashboard: ['Espace de Romain', 'Vue d’ensemble'],
  agenda: ['Organisation', 'Agenda'],
  clients: ['Accompagnements', 'Clients'],
  dossiers: ['Mémoire de travail', 'Dossiers'],
  suivi: ['Actions', 'Centre de suivi'],
  bibliotheque: ['Méthodes', 'Bibliothèque'],
  settings: ['Administration', 'Configuration'],
};

const body = document.body;
const previewMode = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).has('preview');
body.dataset.preview = previewMode ? 'true' : 'false';
if (previewMode) {
  document.getElementById('gate-submit-label').textContent = 'Ouvrir la maquette';
  document.getElementById('gate-note-label').textContent = 'Mode aperçu local · aucune donnée réelle';
}
const gate = document.getElementById('coach-gate');
const app = document.getElementById('coach-app');
const sidebar = document.getElementById('coach-sidebar');
const drawer = document.getElementById('client-drawer');
const drawerContent = document.getElementById('drawer-content');
const noteModal = document.getElementById('note-modal');
const noteForm = document.getElementById('note-form');
const actionModal = document.getElementById('action-modal');
const actionForm = document.getElementById('action-form');
const toast = document.getElementById('coach-toast');
const searchResults = document.getElementById('search-results');
const globalSearch = document.getElementById('global-search');
let toastTimer = null;
let noteClientId = null;
let activeView = 'dashboard';
let consoleMode = 'demo';
let liveCoachId = null;
let liveUserId = null;
let liveSession = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function safeAvatar(value) {
  const avatar = String(value || '');
  return avatar.startsWith('/') || /^https:\/\//i.test(avatar) ? avatar : '/favicon.svg';
}

function updateStorageLabels() {
  const live = consoleMode === 'live';
  const drawerState = document.querySelector('#client-drawer .save-state');
  const draftState = document.querySelector('#note-modal .draft-state');
  const notePrivacy = noteForm?.querySelector('footer p');
  if (drawerState) drawerState.innerHTML = `<i></i> ${live ? 'Supabase · synchronisé' : 'Maquette · non synchronisée'}`;
  if (draftState) draftState.innerHTML = `<i></i> ${live ? 'Brouillon privé Supabase' : 'Brouillon local'}`;
  if (notePrivacy) notePrivacy.innerHTML = `<svg><use href="#co-icon-lock"></use></svg>${live ? 'Cette note est protégée et visible uniquement par le coach assigné.' : 'Cette note reste uniquement sur cet appareil de démonstration.'}`;
}

function renderLiveClientRows() {
  const table = document.querySelector('.clients-table');
  const head = table?.querySelector('.client-head');
  const empty = document.getElementById('empty-clients');
  if (!table || !head || !empty) return;
  table.querySelectorAll('[data-client-row]').forEach((row) => row.remove());
  const markup = Object.values(clients).map((client) => `
    <button class="client-row" type="button" data-client-row data-client-id="${client.id}" data-filter="${client.filter}">
      <span class="client-identity"><i class="avatar ${client.avatar}">${client.initials}</i><span><strong>${client.name}</strong><small>${client.email}</small></span></span>
      <span><b class="status-pill ${client.filter === 'premium' ? 'purple' : client.filter === 'pause' ? 'gray' : 'blue'}">${client.type}</b><small>${client.status}</small></span>
      <span><strong>${client.next}</strong><small>Europe/Zurich</small></span>
      <span class="progress-cell"><i><b style="width:${client.progress}%"></b></i><small>${client.journey}</small></span>
      <span><b class="status-pill ${client.preparation === 'Préparation en attente.' ? 'gray' : 'green'}">${client.preparation === 'Préparation en attente.' ? 'En attente' : 'Prête'}</b></span>
      <span><svg><use href="#co-icon-chevron"></use></svg></span>
    </button>`).join('');
  head.insertAdjacentHTML('afterend', markup);
  document.querySelectorAll('[data-client-filter] b').forEach((node) => { node.textContent = String(Object.keys(clients).length); });
}

async function loadLiveCoachData(session) {
  liveSession = session;
  const { data: coach, error: coachError } = await coachingSupabase.from('coaching_coaches').select('id,slug,first_name,last_name,email,avatar_url,calendar_connected_at').eq('auth_user_id', session.user.id).single();
  if (coachError) throw coachError;
  const coachName = [coach.first_name, coach.last_name].filter(Boolean).join(' ') || 'Coach';
  viewMeta.dashboard[0] = `Espace de ${coachName}`;
  document.getElementById('view-kicker').textContent = viewMeta.dashboard[0];
  document.title = `Espace Coaching — ${coachName}`;
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  document.querySelectorAll('[data-coach-avatar]').forEach((image) => {
    image.src = safeAvatar(coach.avatar_url);
    image.alt = coachName;
  });
  liveCoachId = coach.id;
  liveUserId = session.user.id;
  const [clientResult, sessionsResult, engagementsResult, responsesResult, actionsResult, availabilityResult, creditsResult] = await Promise.all([
    coachingSupabase.from('coaching_clients').select('id,first_name,last_name,email,phone,status,objective,created_at').eq('coach_id', coach.id).neq('status', 'archived').order('created_at', { ascending: false }),
    coachingSupabase.from('coaching_sessions').select('id,client_id,starts_at,ends_at,status,meet_url').eq('coach_id', coach.id).order('starts_at', { ascending: false }),
    coachingSupabase.from('coaching_engagements').select('id,client_id,status,started_at,expires_at,coaching_offers(name,sessions_count)').eq('coach_id', coach.id).order('started_at', { ascending: false }),
    coachingSupabase.from('coaching_form_responses').select('id,client_id,status,answers,submitted_at').order('created_at', { ascending: false }),
    coachingSupabase.from('coaching_actions').select('id,client_id,title,status,due_at,priority,completed_at,updated_at').eq('coach_id', coach.id).in('status', ['open', 'done']).order('updated_at', { ascending: false }).limit(100),
    coachingSupabase.from('coaching_availability_slots').select('id,starts_at,ends_at,status').eq('coach_id', coach.id).eq('status', 'available').gte('starts_at', new Date().toISOString()).order('starts_at').limit(100),
    coachingSupabase.from('coaching_credit_ledger').select('client_id,engagement_id,quantity'),
  ]);
  const failure = [clientResult, sessionsResult, engagementsResult, responsesResult, actionsResult, availabilityResult, creditsResult].find((result) => result.error)?.error;
  if (failure) throw failure;
  const sessions = sessionsResult.data || [];
  const engagements = engagementsResult.data || [];
  const responses = responsesResult.data || [];
  const actions = actionsResult.data || [];
  const activeEngagementIds = new Set(engagements.filter((item) => item.status === 'active' && (!item.expires_at || new Date(item.expires_at).getTime() > Date.now())).map((item) => item.id));
  const creditBalance = new Map();
  (creditsResult.data || []).filter((item) => !item.engagement_id || activeEngagementIds.has(item.engagement_id)).forEach((item) => {
    creditBalance.set(item.client_id, (creditBalance.get(item.client_id) || 0) + Number(item.quantity || 0));
  });
  Object.keys(clients).forEach((key) => delete clients[key]);
  for (const row of clientResult.data || []) {
    const clientSessions = sessions.filter((item) => item.client_id === row.id);
    const future = clientSessions.filter((item) => item.status === 'confirmed' && new Date(item.starts_at) >= new Date()).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0];
    const noteSession = future || clientSessions.find((item) => !['cancelled', 'no_show'].includes(item.status));
    const activeEngagements = engagements.filter((item) => item.client_id === row.id && item.status === 'active' && (!item.expires_at || new Date(item.expires_at).getTime() > Date.now()));
    const engagement = activeEngagements[0] || engagements.find((item) => item.client_id === row.id);
    const offer = engagement?.coaching_offers;
    const prep = responses.find((item) => item.client_id === row.id && item.status === 'submitted');
    const completed = clientSessions.filter((item) => item.status === 'completed').length;
    const total = Number(activeEngagements.reduce((sum, item) => sum + Number(item.coaching_offers?.sessions_count || 0), 0) || offer?.sessions_count || Math.max(completed + (future ? 1 : 0), 1));
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ');
    const initials = fullName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    clients[row.id] = {
      id: row.id,
      initials: escapeHtml(initials),
      avatar: '',
      nameText: fullName,
      name: escapeHtml(fullName),
      email: escapeHtml(row.email),
      phone: escapeHtml(row.phone || 'Téléphone non renseigné'),
      type: escapeHtml(offer?.name || 'Première consultation'),
      filter: row.status === 'paused' ? 'pause' : total > 1 ? 'premium' : 'consultation',
      status: prep ? 'Préparation reçue' : 'Préparation attendue',
      next: future ? escapeHtml(formatDateTime(future.starts_at)) : 'Non planifiée',
      nextSessionId: future?.id || null,
      nextSessionStart: future?.starts_at || null,
      noteSessionId: noteSession?.id || null,
      noteSessionStart: noteSession?.starts_at || null,
      noteSessionStatus: noteSession?.status || null,
      meetUrl: future?.meet_url || null,
      objective: escapeHtml(row.objective || prep?.answers?.outcome || 'Objectif à clarifier avec le client.'),
      context: escapeHtml([prep?.answers?.progress, prep?.answers?.obstacle, prep?.answers?.context].filter(Boolean).join(' ') || 'Aucun contexte supplémentaire transmis.'),
      preparation: escapeHtml(prep?.answers?.subject || 'Préparation en attente.'),
      focus: escapeHtml(prep?.answers?.outcome || 'Clarifier le prochain pas'),
      journey: `${completed}/${total} séance${total > 1 ? 's' : ''}`,
      progress: Math.min(Math.round((completed / total) * 100), 100),
      sessions: clientSessions.map((item) => ({ title: 'Séance de coaching', date: escapeHtml(formatDateTime(item.starts_at)), status: item.status === 'completed' ? 'Terminée' : item.status === 'cancelled' ? 'Annulée' : 'À venir' })),
      commitments: actions.filter((item) => item.client_id === row.id && item.status === 'open').map((item) => escapeHtml(item.title)),
      credits: Math.max(creditBalance.get(row.id) || 0, 0),
    };
  }
  renderLiveClientRows();
  document.querySelector('.sidebar-status strong').textContent = 'Supabase connecté';
  document.querySelector('.sidebar-status small').textContent = `${Object.keys(clients).length} client(s) attribué(s)`;
  document.querySelector('.preview-badge strong').textContent = 'Données réelles';
  document.querySelector('.preview-badge small').textContent = `Accès isolé de ${coachName}`;
  const calendarBadge = document.querySelector('[data-view-panel="settings"] .integration-card .status-pill');
  if (calendarBadge && coach.calendar_connected_at) {
    calendarBadge.textContent = 'Connecté';
    calendarBadge.classList.remove('amber');
    calendarBadge.classList.add('green');
  }
  document.querySelector('.metric-card.green strong').textContent = String(Object.keys(clients).length);
  document.querySelector('.metric-card.purple strong').textContent = String(actions.filter((item) => item.status === 'open').length);
  renderLiveWorkspace(sessions, actions, availabilityResult.data || []);
  const rulesResult = await coachingSupabase.from('coaching_availability_rules').select('weekday,start_time,end_time,slot_minutes,buffer_minutes').eq('coach_id', coach.id).eq('active', true).order('weekday');
  if (!rulesResult.error && rulesResult.data?.length) {
    const days = new Set(rulesResult.data.map((rule) => String(rule.weekday)));
    document.querySelectorAll('[data-availability-day]').forEach((input) => { input.checked = days.has(input.value); });
    const firstRule = rulesResult.data[0];
    const availabilityForm = document.querySelector('[data-availability-form]');
    availabilityForm.elements.namedItem('start').value = String(firstRule.start_time).slice(0, 5);
    availabilityForm.elements.namedItem('end').value = String(firstRule.end_time).slice(0, 5);
    availabilityForm.elements.namedItem('duration').value = String(firstRule.slot_minutes);
    availabilityForm.elements.namedItem('buffer').value = String(firstRule.buffer_minutes);
    document.querySelector('[data-availability-feedback]').textContent = `${rulesResult.data.length} jour(s) ouvert(s) enregistré(s).`;
  }
}

function renderLiveWorkspace(sessions, actions, availableSlots) {
  const now = Date.now();
  const dueTime = (action) => action.due_at ? new Date(action.due_at).getTime() : Number.POSITIVE_INFINITY;
  const openActions = actions.filter((action) => action.status === 'open').sort((a, b) => dueTime(a) - dueTime(b));
  const doneActions = actions.filter((action) => action.status === 'done').slice(0, 12);
  const upcoming = sessions.filter((item) => item.status === 'confirmed' && new Date(item.starts_at).getTime() >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
  const todaySessions = upcoming.filter((item) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(item.starts_at)) === todayKey);
  const firstSession = upcoming[0];
  const firstClient = firstSession ? clients[firstSession.client_id] : null;
  document.querySelector('.metric-card.blue strong').textContent = String(todaySessions.length);
  document.querySelector('.metric-card.blue p').textContent = `${todaySessions.length} séance${todaySessions.length > 1 ? 's' : ''} confirmée${todaySessions.length > 1 ? 's' : ''}`;

  const card = document.querySelector('.next-session');
  if (card && firstClient) {
    card.querySelector('.card-heading .eyebrow').textContent = 'Prochaine séance confirmée';
    card.querySelector('[data-client-id]').dataset.clientId = firstClient.id;
    card.querySelector('.session-person .avatar').textContent = firstClient.initials;
    card.querySelector('.session-person > div:nth-child(2) strong').textContent = firstClient.nameText;
    card.querySelector('.session-person > div:nth-child(2) p').textContent = firstClient.type;
    card.querySelector('.session-person > div:nth-child(2) span').innerHTML = `<i></i> ${firstClient.preparation === 'Préparation en attente.' ? 'Préparation attendue' : 'Préparation complétée'}`;
    const date = new Date(firstSession.starts_at);
    card.querySelector('.session-time small').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Zurich' }).format(date);
    card.querySelector('.session-time strong').textContent = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(date);
    card.querySelector('.prep-grid > div:first-child p').textContent = `« ${firstClient.preparation} »`;
    card.querySelector('.prep-grid > div:nth-child(2) ul').innerHTML = `<li>${firstClient.context}</li><li>${firstClient.journey}</li>`;
    const noteButton = card.querySelector('[data-note-client]');
    noteButton.dataset.noteClient = firstClient.id;
    const meetButton = card.querySelector('.meet-button');
    if (firstClient.meetUrl) {
      meetButton.dataset.meetUrl = firstClient.meetUrl;
      delete meetButton.dataset.toast;
      card.querySelector('.integration-hint').textContent = 'Lien Meet prêt';
    }
  }

  const dayTimeline = document.querySelector('.day-timeline');
  if (dayTimeline) dayTimeline.innerHTML = todaySessions.length ? todaySessions.map((item) => {
    const client = clients[item.client_id];
    const time = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(new Date(item.starts_at));
    return `<button class="timeline-row" type="button" data-client-id="${client.id}"><time>${time}</time><i></i><span><strong>${client.name}</strong><small>${client.type}</small></span><b>${client.preparation === 'Préparation en attente.' ? 'À préparer' : 'Préparé'}</b></button>`;
  }).join('') : '<div class="timeline-free"><time>—</time><i></i><span><strong>Aucune séance aujourd’hui</strong><small>La journée est libre.</small></span></div>';

  const folders = document.querySelector('.folder-grid');
  if (folders) folders.innerHTML = Object.values(clients).slice(0, 6).map((client) => `<button class="folder-card glass-card" type="button" data-client-id="${client.id}"><span class="folder-top"><i class="avatar">${client.initials}</i><b class="status-pill ${client.nextSessionId ? 'blue' : 'gray'}">${client.nextSessionId ? 'Séance planifiée' : 'À planifier'}</b></span><strong>${client.name}</strong><p>${client.objective}</p><span class="folder-meta"><small>${client.sessions.length} séance(s)</small><small>${client.status}</small></span><span class="folder-action">Ouvrir le dossier<svg><use href="#co-icon-arrow"></use></svg></span></button>`).join('');

  const follow = document.querySelector('.follow-grid');
  if (follow) {
    const actionMarkup = (action, checked = false) => {
      const client = clients[action.client_id];
      return `<article class="task-card${checked ? ' is-done' : ''}"><span class="task-label ${action.priority === 'high' ? 'amber' : action.priority === 'low' ? 'gray' : 'blue'}">${escapeHtml(action.priority || 'normal')}</span><h3>${escapeHtml(action.title)}</h3>${client ? `<button type="button" data-client-id="${client.id}"><i class="avatar">${client.initials}</i><span>${client.name}</span><svg><use href="#co-icon-chevron"></use></svg></button>` : ''}<footer><time>${action.due_at ? escapeHtml(formatDateTime(action.due_at)) : 'Sans échéance'}</time><label aria-label="${checked ? 'Rouvrir' : 'Terminer'} cette action"><input type="checkbox" data-action-id="${escapeHtml(action.id)}" ${checked ? 'checked' : ''} /><span><svg><use href="#co-icon-check"></use></svg></span></label></footer></article>`;
    };
    follow.classList.add('is-live');
    follow.innerHTML = `<section class="follow-column glass-card"><header><span class="column-dot amber"></span><div><strong>Actions ouvertes</strong><small>Source Supabase</small></div><b>${openActions.length}</b></header>${openActions.length ? openActions.map((action) => actionMarkup(action)).join('') : '<div class="empty-results"><strong>Aucune action ouverte.</strong><small>Rien ne demande ton attention.</small></div>'}</section><section class="follow-column glass-card"><header><span class="column-dot green"></span><div><strong>Terminées récemment</strong><small>Réouverture possible</small></div><b>${doneActions.length}</b></header>${doneActions.length ? doneActions.map((action) => actionMarkup(action, true)).join('') : '<div class="empty-results"><strong>Aucune action terminée.</strong><small>Les dernières actions cochées apparaîtront ici.</small></div>'}</section>`;
  }

  const focusList = document.querySelector('.focus-list');
  if (focusList) {
    focusList.innerHTML = openActions.length ? openActions.slice(0, 4).map((action) => `<label><input type="checkbox" data-action-id="${escapeHtml(action.id)}" /><span><i><svg><use href="#co-icon-check"></use></svg></i><strong>${escapeHtml(action.title)}</strong><small>${action.due_at ? escapeHtml(formatDateTime(action.due_at)) : 'Sans échéance'}</small></span></label>`).join('') : '<div class="empty-results"><strong>Focus terminé.</strong><small>Aucune action ouverte.</small></div>';
    const focusCount = document.querySelector('.focus-card .progress-ring');
    if (focusCount) focusCount.textContent = String(openActions.length);
  }

  const attention = document.querySelector('.attention-card');
  if (attention) {
    attention.querySelector('h3').textContent = `${openActions.length} élément${openActions.length > 1 ? 's' : ''} mérite${openActions.length > 1 ? 'nt' : ''} ton attention`;
    attention.querySelector('.attention-list').innerHTML = openActions.slice(0, 4).map((action) => {
      const client = clients[action.client_id];
      return `<button type="button" ${client ? `data-client-id="${client.id}"` : ''}><span class="attention-icon ${action.priority === 'high' ? 'amber' : 'blue'}"><svg><use href="#co-icon-check"></use></svg></span><span><strong>${escapeHtml(action.title)}</strong><small>${client?.name || 'Action coaching'}</small></span><time>${action.due_at ? escapeHtml(formatDateTime(action.due_at)) : 'À organiser'}</time><svg><use href="#co-icon-chevron"></use></svg></button>`;
    }).join('') || '<div class="empty-results"><strong>Tout est à jour.</strong><small>Aucune attention particulière.</small></div>';
  }

  const weekGrid = document.querySelector('.week-grid');
  if (weekGrid) {
    const days = Array.from({ length: 5 }, (_, index) => new Date(Date.now() + index * 86400000));
    weekGrid.classList.add('live-week');
    weekGrid.innerHTML = days.map((day) => {
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(day);
      const daySessions = upcoming.filter((item) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(item.starts_at)) === key);
      const daySlots = availableSlots.filter((item) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(item.starts_at)) === key);
      const label = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'Europe/Zurich' }).format(day);
      const number = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'Europe/Zurich' }).format(day);
      return `<section class="week-day"><header><span>${escapeHtml(label)}</span><strong>${escapeHtml(number)}</strong></header>${daySessions.map((item) => {
        const client = clients[item.client_id];
        const time = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(new Date(item.starts_at));
        return client ? `<button class="calendar-event blue" type="button" data-client-id="${client.id}"><small>${time}</small><strong>${client.name}</strong><span>${client.type}</span></button>` : '';
      }).join('')}${daySlots.map((slot) => `<div class="available-slot"><span>Disponible</span><small>${new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(new Date(slot.starts_at))}</small></div>`).join('') || (!daySessions.length ? '<div class="timeline-free"><span><strong>Aucun créneau</strong></span></div>' : '')}</section>`;
    }).join('');
    const toolbar = document.querySelector('.calendar-toolbar strong');
    if (toolbar) toolbar.textContent = '5 prochains jours';
  }
}

function showApp() {
  gate.hidden = true;
  app.hidden = false;
  const initial = window.location.hash.replace('#', '');
  if (viewMeta[initial]) switchView(initial, false);
}

function showToast(message) {
  toast.querySelector('p').textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function switchView(view, updateHash = true) {
  if (!viewMeta[view]) return;
  activeView = view;
  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.viewPanel === view);
  });
  document.querySelectorAll('.nav-item[data-view-target]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewTarget === view);
  });
  document.getElementById('view-kicker').textContent = viewMeta[view][0];
  document.getElementById('view-title').textContent = viewMeta[view][1];
  if (updateHash) history.replaceState(null, '', '#' + view);
  sidebar.classList.remove('is-open');
  document.getElementById('coach-menu').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clientMarkup(client) {
  const sessionHtml = client.sessions.map((session) => `
    <div class="drawer-session">
      <span><svg><use href="#co-icon-calendar"></use></svg></span>
      <div><strong>${session.title}</strong><small>${session.status}</small></div>
      <time>${session.date}</time>
    </div>
  `).join('');
  const commitmentHtml = client.commitments.map((item) => `<li>${item}</li>`).join('');
  return `
    <div class="drawer-profile">
      <section class="drawer-profile-head">
        <span class="avatar ${client.avatar}">${client.initials}</span>
        <div><h2 id="drawer-client-name">${client.name}</h2><p>${client.email} · ${client.phone}</p></div>
        <div class="drawer-contact-actions">
          <a href="mailto:${client.email}" aria-label="Envoyer un email"><svg><use href="#co-icon-mail"></use></svg></a>
          <a href="tel:${client.phone.replace(/\s/g, '')}" aria-label="Appeler"><svg><use href="#co-icon-phone"></use></svg></a>
        </div>
      </section>
      <div class="drawer-summary-grid">
        <div><small>Accompagnement</small><strong>${client.type}</strong></div>
        <div><small>Prochaine séance</small><strong>${client.next}</strong></div>
        <div><small>Crédits disponibles</small><strong>${Number(client.credits || 0)} · ${Number(client.credits || 0) * 15} min</strong></div>
        <div><small>État du dossier</small><strong>${client.status}</strong></div>
      </div>
      <div class="drawer-tabs" role="tablist">
        <button class="is-active" type="button">Vue utile</button>
        <button type="button" data-toast="L’historique complet sera chargé depuis Supabase.">Historique</button>
        <button type="button" data-toast="Les documents seront stockés avec une politique privée Supabase Storage.">Documents</button>
      </div>
      <section class="drawer-block">
        <header><h3>Objectif actuel</h3><span class="status-pill blue">${client.focus}</span></header>
        <p>${client.objective}</p>
      </section>
      <section class="drawer-block">
        <header><h3>Ce que le coach doit savoir</h3><small>${client.journey}</small></header>
        <p>${client.context}</p>
      </section>
      <section class="drawer-block">
        <header><h3>Préparation du client</h3><small>Formulaire post-paiement</small></header>
        <p>« ${client.preparation} »</p>
      </section>
      <section class="drawer-block">
        <header><h3>Engagements ouverts</h3><small>${client.commitments.length} élément${client.commitments.length > 1 ? 's' : ''}</small></header>
        <ul>${commitmentHtml}</ul>
      </section>
      <section class="drawer-block">
        <header><h3>Séances</h3><small>${client.sessions.length} affichée${client.sessions.length > 1 ? 's' : ''}</small></header>
        <div class="drawer-session-list">${sessionHtml}</div>
      </section>
      <div class="drawer-footer-actions">
        <button class="secondary-button" type="button" data-toast="La planification sera synchronisée avec Google Calendar."><svg><use href="#co-icon-calendar"></use></svg><span>Planifier</span></button>
        ${consoleMode === 'live' && client.noteSessionStatus === 'confirmed' && new Date(client.noteSessionStart).getTime() <= Date.now() + 15 * 60 * 1000 ? `<button class="secondary-button" type="button" data-complete-client="${client.id}"><svg><use href="#co-icon-check"></use></svg><span>Marquer terminée</span></button>` : ''}
        <button class="primary-button" type="button" data-note-client="${client.id}"><svg><use href="#co-icon-note"></use></svg><span>Écrire une note</span></button>
      </div>
    </div>
  `;
}

function syncBodyLock() {
  const overlayOpen = drawer.classList.contains('is-open')
    || noteModal.classList.contains('is-open')
    || actionModal.classList.contains('is-open');
  body.style.overflow = overlayOpen ? 'hidden' : '';
}

function openClient(id) {
  const client = clients[id];
  if (!client) return;
  drawerContent.innerHTML = clientMarkup(client);
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  body.style.overflow = 'hidden';
}

function closeClient() {
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  syncBodyLock();
}

async function openNote(id) {
  const client = clients[id];
  if (!client) return;
  noteClientId = id;
  document.getElementById('note-title').textContent = 'Préparer la séance avec ' + (client.nameText || client.name).split(' ')[0];
  document.getElementById('note-client').innerHTML = `
    <span class="avatar ${client.avatar}">${client.initials}</span>
    <span><strong>${client.name}</strong><small>${client.type} · ${client.next}</small></span>
  `;
  noteForm.reset();
  let draft = null;
  if (consoleMode === 'live' && client.noteSessionId) {
    const existing = await coachingSupabase.from('coaching_session_notes').select('intention,observations,decision,commitment,next_focus').eq('session_id', client.noteSessionId).eq('coach_id', liveCoachId).maybeSingle();
    if (!existing.error && existing.data) draft = { ...existing.data, next: existing.data.next_focus };
  } else if (consoleMode === 'demo') {
    try { draft = JSON.parse(localStorage.getItem('coach-note-' + id) || 'null'); } catch {}
  }
  if (draft) {
    Object.entries(draft).forEach(([name, value]) => {
      const field = noteForm.elements.namedItem(name);
      if (field) field.value = String(value || '');
    });
  } else {
    noteForm.elements.namedItem('intention').value = client.objective;
  }
  noteModal.classList.add('is-open');
  noteModal.setAttribute('aria-hidden', 'false');
  body.style.overflow = 'hidden';
  window.setTimeout(() => noteForm.elements.namedItem('observations').focus(), 180);
}

function closeNote() {
  noteModal.classList.remove('is-open');
  noteModal.setAttribute('aria-hidden', 'true');
  syncBodyLock();
}

function openAction() {
  actionForm.reset();
  const clientSelect = actionForm.elements.namedItem('client_id');
  const options = Object.values(clients)
    .sort((a, b) => String(a.nameText || a.name).localeCompare(String(b.nameText || b.name), 'fr'))
    .map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.nameText || client.name)}</option>`)
    .join('');
  clientSelect.innerHTML = `<option value="">Choisir un client…</option>${options}`;
  actionModal.classList.add('is-open');
  actionModal.setAttribute('aria-hidden', 'false');
  syncBodyLock();
  window.setTimeout(() => clientSelect.focus(), 180);
}

function closeAction() {
  actionModal.classList.remove('is-open');
  actionModal.setAttribute('aria-hidden', 'true');
  syncBodyLock();
}

async function completeClientSession(id) {
  if (consoleMode !== 'live') return;
  const client = clients[id];
  if (!client?.noteSessionId) return showToast('Aucune séance à clôturer.');
  const { error } = await coachingSupabase.rpc('coaching_complete_session', { p_session_id: client.noteSessionId });
  if (error) return showToast('La séance n’a pas pu être clôturée.');
  client.noteSessionStatus = 'completed';
  const session = client.sessions.find((item) => item.status === 'À venir');
  if (session) session.status = 'Terminée';
  closeClient();
  showToast('Séance terminée et ajoutée à l’historique.');
}

function renderGlobalSearch(query) {
  const value = query.trim().toLocaleLowerCase('fr');
  if (!value) {
    searchResults.hidden = true;
    searchResults.innerHTML = '';
    return;
  }
  const matches = Object.values(clients).filter((client) =>
    [client.name, client.email, client.objective, client.type].join(' ').toLocaleLowerCase('fr').includes(value)
  ).slice(0, 6);
  searchResults.innerHTML = matches.length ? matches.map((client) => `
    <button class="search-result" type="button" data-client-id="${client.id}">
      <span class="avatar ${client.avatar}">${client.initials}</span>
      <span><strong>${client.name}</strong><small>${client.type} · ${client.next}</small></span>
      <svg><use href="#co-icon-chevron"></use></svg>
    </button>
  `).join('') : '<p class="search-empty">Aucun dossier ne correspond à cette recherche.</p>';
  searchResults.hidden = false;
}

function filterClientRows() {
  const query = (document.getElementById('client-search')?.value || '').trim().toLocaleLowerCase('fr');
  const activeFilter = document.querySelector('[data-client-filter].is-active')?.dataset.clientFilter || 'all';
  let visible = 0;
  document.querySelectorAll('[data-client-row]').forEach((row) => {
    const client = clients[row.dataset.clientId];
    const matchesQuery = !query || [client.name, client.email, client.objective, client.type].join(' ').toLocaleLowerCase('fr').includes(query);
    const matchesFilter = activeFilter === 'all' || row.dataset.filter === activeFilter;
    row.hidden = !(matchesQuery && matchesFilter);
    if (!row.hidden) visible += 1;
  });
  document.getElementById('empty-clients').hidden = visible !== 0;
}

document.getElementById('coach-gate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (previewMode) showApp();
  else window.location.href = coachingUrl('/coaching');
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const viewButton = target.closest('[data-view-target]');
  if (viewButton) switchView(viewButton.dataset.viewTarget);

  const clientButton = target.closest('[data-client-id]');
  if (clientButton) {
    searchResults.hidden = true;
    globalSearch.value = '';
    openClient(clientButton.dataset.clientId);
  }

  const noteButton = target.closest('[data-note-client]');
  if (noteButton) openNote(noteButton.dataset.noteClient);

  if (target.closest('[data-new-action]')) openAction();

  const completeButton = target.closest('[data-complete-client]');
  if (completeButton) completeClientSession(completeButton.dataset.completeClient);

  if (target.closest('[data-drawer-close]')) closeClient();
  if (target.closest('[data-note-close]')) closeNote();
  if (target.closest('[data-action-close]')) closeAction();

  const meetButton = target.closest('[data-meet-url]');
  if (meetButton) window.open(meetButton.dataset.meetUrl, '_blank', 'noopener');

  const toastButton = target.closest('[data-toast]');
  if (toastButton) showToast(toastButton.dataset.toast);
});

document.getElementById('menu-button').addEventListener('click', () => sidebar.classList.add('is-open'));
document.getElementById('sidebar-close').addEventListener('click', () => sidebar.classList.remove('is-open'));

document.getElementById('coach-switcher').addEventListener('click', () => {
  const menu = document.getElementById('coach-menu');
  menu.hidden = !menu.hidden;
  document.getElementById('coach-switcher').setAttribute('aria-expanded', String(!menu.hidden));
});

globalSearch.addEventListener('input', () => renderGlobalSearch(globalSearch.value));
globalSearch.addEventListener('focus', () => renderGlobalSearch(globalSearch.value));

document.addEventListener('click', (event) => {
  if (!event.target.closest('.global-search') && !event.target.closest('#search-results')) searchResults.hidden = true;
  if (!event.target.closest('#coach-switcher') && !event.target.closest('#coach-menu')) document.getElementById('coach-menu').hidden = true;
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    globalSearch.focus();
  }
  if (event.key === 'Escape') {
    searchResults.hidden = true;
    document.getElementById('coach-menu').hidden = true;
    if (actionModal.classList.contains('is-open')) closeAction();
    else if (noteModal.classList.contains('is-open')) closeNote();
    else if (drawer.classList.contains('is-open')) closeClient();
    else sidebar.classList.remove('is-open');
  }
});

document.getElementById('client-search').addEventListener('input', filterClientRows);
document.querySelectorAll('[data-client-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-client-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
    filterClientRows();
  });
});

noteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!noteClientId) return;
  const draft = Object.fromEntries(new FormData(noteForm).entries());
  if (consoleMode === 'live') {
    const client = clients[noteClientId];
    if (!client?.noteSessionId) return showToast('Planifie d’abord une séance pour rattacher cette note.');
    const { error } = await coachingSupabase.from('coaching_session_notes').upsert({
      session_id: client.noteSessionId,
      coach_id: liveCoachId,
      author_user_id: liveUserId,
      status: 'draft',
      intention: draft.intention || null,
      observations: draft.observations || null,
      decision: draft.decision || null,
      commitment: draft.commitment || null,
      next_focus: draft.next || null,
    }, { onConflict: 'session_id,coach_id' });
    if (error) return showToast('La note n’a pas pu être enregistrée.');
  } else {
    try { localStorage.setItem('coach-note-' + noteClientId, JSON.stringify(draft)); } catch {}
  }
  closeNote();
  showToast(consoleMode === 'live' ? 'Brouillon privé enregistré dans le dossier.' : 'Brouillon enregistré uniquement sur cet appareil.');
});

actionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = actionForm.querySelector('[type="submit"]');
  const draft = Object.fromEntries(new FormData(actionForm).entries());
  if (consoleMode === 'demo') {
    closeAction();
    return showToast('Action créée dans la maquette. Elle sera persistante avec Supabase.');
  }
  if (!clients[draft.client_id]) return showToast('Choisis un dossier client attribué.');
  submit.disabled = true;
  const dueAt = draft.due_at ? new Date(draft.due_at).toISOString() : null;
  const { error } = await coachingSupabase.from('coaching_actions').insert({
    client_id: draft.client_id,
    coach_id: liveCoachId,
    title: String(draft.title || '').trim(),
    due_at: dueAt,
    priority: draft.priority || 'normal',
    status: 'open',
    visibility: 'coach',
    origin: 'manual',
  });
  submit.disabled = false;
  if (error) return showToast('L’action n’a pas pu être créée.');
  closeAction();
  await loadLiveCoachData(liveSession);
  showToast('Action ajoutée au suivi privé du coach.');
});

document.addEventListener('change', async (event) => {
  const checkbox = event.target instanceof HTMLInputElement ? event.target : null;
  if (!checkbox?.matches('.focus-list input, .task-card footer input')) return;
  const actionId = checkbox.dataset.actionId;
  if (consoleMode !== 'live' || !actionId) {
    showToast(checkbox.checked ? 'Action marquée comme terminée dans la maquette.' : 'Action rouverte dans la maquette.');
    return;
  }
  checkbox.disabled = true;
  const done = checkbox.checked;
  const { error } = await coachingSupabase.from('coaching_actions').update({
    status: done ? 'done' : 'open',
    completed_at: done ? new Date().toISOString() : null,
  }).eq('id', actionId).eq('coach_id', liveCoachId);
  if (error) {
    checkbox.checked = !done;
    checkbox.disabled = false;
    return showToast('Le statut de l’action n’a pas pu être modifié.');
  }
  await loadLiveCoachData(liveSession);
  showToast(done ? 'Action terminée. Elle reste réouvrable.' : 'Action rouverte.');
});

document.querySelector('[data-connect-google]')?.addEventListener('click', async () => {
  if (consoleMode === 'demo') return showToast('La connexion Google sera active en mode réel.');
  const { data: { session } } = await coachingSupabase.auth.getSession();
  const response = await fetch('/.netlify/functions/coaching-google-connect', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) return showToast(payload.error || 'Connexion Google impossible.');
  window.location.href = payload.url;
});

document.querySelector('[data-sync-google]')?.addEventListener('click', async () => {
  if (consoleMode === 'demo') return showToast('La synchronisation sera active en mode réel.');
  const { data: { session } } = await coachingSupabase.auth.getSession();
  const response = await fetch('/.netlify/functions/coaching-sync-availability', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' }, body: '{}' });
  const payload = await response.json().catch(() => ({}));
  showToast(response.ok ? `${payload.available} créneau(x) disponible(s) synchronisé(s).` : payload.error || 'Synchronisation impossible.');
});

document.querySelector('[data-availability-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (consoleMode === 'demo') return showToast('Plages test enregistrées dans la maquette.');
  const form = event.currentTarget;
  const days = [...form.querySelectorAll('[data-availability-day]:checked')].map((input) => Number(input.value));
  const start = form.elements.namedItem('start').value;
  const end = form.elements.namedItem('end').value;
  const feedback = document.querySelector('[data-availability-feedback]');
  if (!days.length || !start || !end || start >= end) return void (feedback.textContent = 'Choisis au moins un jour et une plage horaire valide.');
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const saved = await coachingSupabase.rpc('coaching_replace_my_availability_rules', { p_weekdays: days, p_start_time: start, p_end_time: end, p_slot_minutes: Number(form.elements.namedItem('duration').value), p_buffer_minutes: Number(form.elements.namedItem('buffer').value), p_timezone: 'Europe/Zurich' });
  feedback.textContent = saved.error ? 'Enregistrement impossible pour le moment.' : `${Number(saved.data || days.length)} jour(s) enregistré(s). Lance maintenant la synchronisation Google.`;
  button.disabled = false;
});

document.querySelector('[data-coach-logout]')?.addEventListener('click', async () => {
  if (consoleMode === 'demo') {
    clearDemoSession();
    window.location.href = coachingUrl('/coaching');
  } else await signOutCoaching();
});

syncClaireDashboardFromDemo();
window.addEventListener('coaching-demo-updated', syncClaireDashboardFromDemo);

async function bootConsole() {
  const access = await requireCoachingRole('coach');
  if (!access) return;
  consoleMode = access.mode;
  updateStorageLabels();
  if (consoleMode === 'demo') {
    showApp();
    return;
  }
  try {
    await loadLiveCoachData(access.session);
    showApp();
    const googleResult = new URLSearchParams(window.location.search).get('google');
    if (googleResult === 'connected') showToast('Google Calendar est connecté. Tu peux synchroniser tes créneaux.');
    if (googleResult && googleResult !== 'connected') showToast('La connexion Google n’a pas pu être terminée.');
  } catch (error) {
    console.error('coach console load', error);
    window.location.href = coachingUrl('/coaching?error=coach-data');
  }
}

bootConsole();
