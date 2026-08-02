const STORE_KEY = 'sonnycourt-coaching-demo-v1';
const SESSION_KEY = 'sonnycourt-coaching-session-v1';

const defaultState = {
  version: 1,
  owner: {
    id: 'sonny',
    name: 'Sonny',
    email: 'sonnycourt@gmail.com',
  },
  coaches: [
    {
      id: 'romain',
      name: 'Romain',
      email: 'romain@sonnycourt.com',
      status: 'active',
      activeClients: 12,
      sessionsThisMonth: 28,
      satisfaction: 9.4,
      nextSession: 'Aujourd’hui · 14:00',
    },
  ],
  clients: [
    { id: 'claire', name: 'Claire Martin', email: 'claire@exemple.fr', coachId: 'romain', plan: 'Le mouvement', creditsTotal: 3, creditsUsed: 1, status: 'active', nextSession: 'À réserver' },
    { id: 'thomas', name: 'Thomas Rey', email: 'thomas@exemple.fr', coachId: 'romain', plan: 'La transformation', creditsTotal: 6, creditsUsed: 3, status: 'active', nextSession: 'Aujourd’hui · 16:30' },
    { id: 'manon', name: 'Manon Girard', email: 'manon@exemple.fr', coachId: 'romain', plan: 'Le prochain pas', creditsTotal: 1, creditsUsed: 1, status: 'complete', nextSession: 'Aucune' },
    { id: 'sarah', name: 'Sarah Dubois', email: 'sarah@exemple.fr', coachId: 'romain', plan: 'La transformation', creditsTotal: 6, creditsUsed: 5, status: 'active', nextSession: '4 août · 11:00' },
  ],
  student: {
    id: 'claire',
    firstName: 'Claire',
    lastName: 'Martin',
    email: 'claire@exemple.fr',
    coachId: 'romain',
    plan: 'Le mouvement',
    creditsTotal: 3,
    creditsUsed: 1,
    objective: 'Prendre une décision professionnelle claire et avancer sans revenir constamment en arrière.',
    nextSession: null,
    preparation: {
      completed: false,
      updatedAt: null,
      subject: '',
      progress: '',
      obstacle: '',
      outcome: '',
      context: '',
    },
    history: [
      { date: '18 juillet 2026', label: 'Première consultation', duration: '45 min', status: 'Terminée' },
      { date: '25 juillet 2026', label: 'Séance 1 · Clarifier', duration: '60 min', status: 'Terminée' },
    ],
  },
  activity: [
    { tone: 'green', label: 'Paiement confirmé', detail: 'Claire · formule 3 séances', time: 'Il y a 2 jours' },
    { tone: 'blue', label: 'Questionnaire complété', detail: 'Thomas · séance 3/6', time: 'Hier' },
    { tone: 'purple', label: 'Note finalisée', detail: 'Romain · dossier Sarah', time: 'Hier' },
    { tone: 'amber', label: 'Action en attente', detail: 'Manon · bilan de fin', time: 'Aujourd’hui' },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
export function getDemoState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (stored?.version === defaultState.version) return stored;
  } catch {}
  const state = clone(defaultState);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  return state;
}

export function saveDemoState(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  window.dispatchEvent(new CustomEvent('coaching-demo-updated', { detail: state }));
  return state;
}

export function updateDemoState(updater) {
  const state = getDemoState();
  const updated = updater(state) || state;
  return saveDemoState(updated);
}

export function resetDemoState() {
  const state = clone(defaultState);
  saveDemoState(state);
  return state;
}

export function getDemoSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

export function setDemoSession(role, profile = {}) {
  const session = {
    role,
    profile,
    createdAt: new Date().toISOString(),
    demo: true,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
  return session;
}

export function clearDemoSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export function formatEuros(value) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export function formatDateTime(iso) {
  if (!iso) return 'À réserver';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich',
  }).format(new Date(iso));
}
