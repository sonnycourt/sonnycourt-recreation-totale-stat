import { getDemoState, setDemoSession, updateDemoState } from './coaching-demo-store.js';
import { coachingUrl } from './coaching-routes.js';
import { coachingSupabase, requireCoachingRole } from './coaching-supabase.js';

const form = document.querySelector('[data-preparation-form]');
const saveLabel = document.querySelector('[data-autosave-label]');
let mode = 'demo';
let liveContext = null;
let saveTimer;

function renderCoachName(name) {
  const coachName = name || 'Romain';
  document.querySelectorAll('[data-coach-name]').forEach((node) => { node.textContent = coachName; });
  const context = document.querySelector('[data-coach-placeholder]');
  if (context) context.placeholder = `Seulement ce qui aidera ${coachName} à comprendre la situation actuelle.`;
}

function fillForm(values = {}) {
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field && typeof value === 'string') field.value = value;
  });
}

function collect() {
  return Object.fromEntries(new FormData(form).entries());
}

async function loadLiveContext(session) {
  const { data: client, error: clientError } = await coachingSupabase.from('coaching_clients').select('id,coaching_coaches(first_name,last_name)').eq('auth_user_id', session.user.id).single();
  if (clientError) throw clientError;
  const coach = client.coaching_coaches;
  renderCoachName(coach ? [coach.first_name, coach.last_name].filter(Boolean).join(' ') : 'Romain');
  const { data: template, error: templateError } = await coachingSupabase.from('coaching_form_templates').select('id,slug,version').eq('purpose', 'session_preparation').eq('status', 'active').order('version', { ascending: false }).limit(1).single();
  if (templateError) throw templateError;
  const { data: response, error: responseError } = await coachingSupabase.from('coaching_form_responses').select('id,answers,status').eq('client_id', client.id).eq('template_id', template.id).is('session_id', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (responseError) throw responseError;
  return { session, client, template, response };
}

async function persist(values, submitted = false) {
  if (mode === 'demo') {
    updateDemoState((state) => {
      state.student.preparation = {
        ...state.student.preparation,
        ...values,
        completed: submitted || state.student.preparation.completed,
        updatedAt: new Date().toISOString(),
      };
      if (submitted && !state.activity.some((item) => item.label === 'Préparation complétée' && item.time === 'À l’instant')) {
        state.activity.unshift({ tone: 'blue', label: 'Préparation complétée', detail: 'Claire · prochaine séance', time: 'À l’instant' });
      }
      return state;
    });
    return;
  }

  const payload = {
    template_id: liveContext.template.id,
    client_id: liveContext.client.id,
    submitted_by: liveContext.session.user.id,
    answers: values,
    status: submitted ? 'submitted' : 'draft',
    submitted_at: submitted ? new Date().toISOString() : null,
  };
  if (liveContext.response?.id) {
    const { error } = await coachingSupabase.from('coaching_form_responses').update(payload).eq('id', liveContext.response.id);
    if (error) throw error;
  } else {
    const { data, error } = await coachingSupabase.from('coaching_form_responses').insert(payload).select('id,answers,status').single();
    if (error) throw error;
    liveContext.response = data;
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveLabel.textContent = 'Enregistrement…';
  saveTimer = window.setTimeout(async () => {
    try {
      await persist(collect(), false);
      saveLabel.textContent = mode === 'demo' ? 'Brouillon enregistré sur cet appareil' : 'Brouillon enregistré dans ton espace';
    } catch {
      saveLabel.textContent = 'Enregistrement impossible — réessaie';
      saveLabel.style.color = 'var(--cp-red)';
    }
  }, 450);
}

async function boot() {
  const access = await requireCoachingRole('client');
  if (!access) return;
  mode = access.mode;
  if (mode === 'demo') {
    setDemoSession('student', { name: 'Claire', email: 'claire@exemple.fr' });
    fillForm(getDemoState().student.preparation);
  } else {
    try {
      liveContext = await loadLiveContext(access.session);
      fillForm(liveContext.response?.answers || {});
      saveLabel.textContent = liveContext.response ? 'Brouillon retrouvé' : 'Tes réponses seront enregistrées automatiquement';
    } catch (error) {
      console.error('coaching preparation load', error);
      saveLabel.textContent = 'Le questionnaire doit encore être configuré.';
      return;
    }
  }

  form.addEventListener('input', scheduleSave);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    window.clearTimeout(saveTimer);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await persist(collect(), true);
      window.location.href = coachingUrl('/coaching/reserver');
    } catch (error) {
      console.error('coaching preparation submit', error);
      saveLabel.textContent = 'Impossible d’enregistrer pour le moment.';
      saveLabel.style.color = 'var(--cp-red)';
      submit.disabled = false;
    }
  });

  document.querySelector('[data-save-later]')?.addEventListener('click', async () => {
    window.clearTimeout(saveTimer);
    try { await persist(collect(), false); } catch {}
    window.location.href = coachingUrl('/coaching/eleve');
  });
}

boot();
