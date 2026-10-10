import { FEEDBACK_VERSION, FEEDBACK_GROUPS, FEEDBACK_TEXT_FIELDS, STEP_REQUIRED_FIELDS, evolutionBranch, normalizeFeedbackAnswers, feedbackSections } from './es2-feedback.mjs';

export function initEs2Feedback() {
  const root = document.getElementById('es2-personal-checkin');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const el = id => root.querySelector('#' + id);
  const form = el('es-form');
  const panels = [...root.querySelectorAll('[data-panel]')];
  const state = { token: '', step: 0, all: false, submitting: false, sent: false, answers: null };
  const preview = new URLSearchParams(location.search).get('preview') === 'dev';
  const selected = name => [...form.querySelectorAll('input[name="' + name + '"]:checked')].map(input => input.value);
  const text = name => String(form.elements.namedItem(name)?.value || '').trim();

  for (const [name, group] of Object.entries(FEEDBACK_GROUPS)) {
    const container = root.querySelector('[data-options="' + name + '"]');
    for (const value of group.values) {
      const label = document.createElement('label'); label.className = 'es-choice';
      const input = document.createElement('input'); input.type = group.multi ? 'checkbox' : 'radio'; input.name = name; input.value = value;
      const span = document.createElement('span'); span.textContent = value;
      label.append(input, span); container.append(label);
    }
  }

  function show(id) {
    for (const name of ['screen-loading', 'screen-gate', 'screen-form', 'screen-success']) el(name).hidden = id !== name;
  }
  function focusPanel() {
    const heading = panels[state.step].querySelector('h2');
    heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function conditional() {
    const evolution = selected('evolution')[0];
    const branch = evolution ? evolutionBranch(evolution) : null;
    for (const name of ['progress', 'stable', 'harder']) el('es-' + name).hidden = branch !== name;
    const priority = selected('priority')[0];
    el('es-priority-other').hidden = !priority;
    el('es-context').hidden = !priority;
    el('es-context').textContent = priority ? 'Ce qui compte pour toi : ' + (text('priorityDetail') || priority) : '';
    root.querySelector('label[for="es-scene"]').textContent = priority ? 'Par rapport à ce souhait, quelle est ta situation aujourd’hui ?' : 'Qu’aimerais-tu me raconter de ta vie en ce moment ?';
  }
  function render() {
    panels.forEach((panel, i) => { panel.hidden = !state.all && i !== state.step; });
    root.querySelectorAll('[data-step]').forEach((button, i) => {
      if (!state.all && i === state.step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    el('es-back').hidden = state.all || state.step === 0;
    el('es-position').textContent = state.all ? 'Vue d’ensemble' : 'Étape ' + (state.step + 1) + ' sur 5';
    el('es-next').textContent = state.all || state.step === 4 ? 'Relire mes réponses →' : 'Continuer →';
    el('es-overview').textContent = state.all ? 'Revenir au parcours guidé' : 'Voir toutes les questions';
    conditional();
  }
  function clearError() { el('es-error').hidden = true; form.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid')); }
  function validateStep(index) {
    for (const name of STEP_REQUIRED_FIELDS[index]) {
      if (FEEDBACK_GROUPS[name] ? selected(name).length : text(name)) continue;
      state.all = false; state.step = index; form.hidden = false; el('es-summary').hidden = true; render();
      const target = form.elements.namedItem(name);
      const control = target?.nodeType ? target : target?.[0];
      if (control) { control.setAttribute('aria-invalid', 'true'); control.focus(); }
      el('es-error').textContent = 'Merci de répondre à cette question avant de continuer.';
      el('es-error').hidden = false;
      return false;
    }
    return true;
  }
  function collect() {
    const answers = {};
    for (const [name, group] of Object.entries(FEEDBACK_GROUPS)) answers[name] = group.multi ? selected(name) : selected(name)[0];
    for (const name of FEEDBACK_TEXT_FIELDS) answers[name] = text(name);
    return normalizeFeedbackAnswers(answers);
  }
  function review() {
    for (let index = 0; index < panels.length; index++) if (!validateStep(index)) return;
    try { state.answers = collect(); }
    catch (error) { el('es-error').textContent = error.message; el('es-error').hidden = false; return; }
    const list = el('es-summary-list'); list.replaceChildren();
    for (const [label, value] of feedbackSections(state.answers)) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value || 'Non renseigné'; list.append(dt, dd);
    }
    form.hidden = true; el('es-summary').hidden = false; el('form-error').textContent = '';
    const heading = el('es-summary').querySelector('h2'); heading.setAttribute('tabindex', '-1'); heading.focus();
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('change', event => {
    clearError();
    const input = event.target;
    if (input.name === 'barrier' && input.checked) {
      form.querySelectorAll('input[name="barrier"]').forEach(other => {
        if (other !== input && (input.value === 'Pas de frein particulier' || other.value === 'Pas de frein particulier')) other.checked = false;
      });
    }
    const group = FEEDBACK_GROUPS[input.name];
    if (group?.multi && input.checked && selected(input.name).length > group.max) {
      input.checked = false; el('es-error').textContent = 'Choisis au maximum ' + group.max + ' réponses pour cette question.'; el('es-error').hidden = false;
    }
    conditional();
  });
  el('es-priority-detail').addEventListener('input', conditional);
  root.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
    if (state.submitting || state.sent) return;
    state.step = Number(button.dataset.step); state.all = false; form.hidden = false; el('es-summary').hidden = true; clearError(); render(); focusPanel();
  }));
  el('es-overview').addEventListener('click', () => {
    if (state.submitting || state.sent) return;
    state.all = !state.all; form.hidden = false; el('es-summary').hidden = true; clearError(); render();
  });
  el('es-back').addEventListener('click', () => { state.step = Math.max(0, state.step - 1); clearError(); render(); focusPanel(); });
  el('es-next').addEventListener('click', () => {
    clearError();
    if (state.all || state.step === 4) review();
    else if (validateStep(state.step)) { state.step++; render(); focusPanel(); }
  });
  el('es-edit').addEventListener('click', () => { if (state.submitting) return; form.hidden = false; el('es-summary').hidden = true; render(); focusPanel(); });

  async function fetchAccess({ token = '', email = '' } = {}) {
    const qs = new URLSearchParams();
    if (token) qs.set('t', token);
    if (email) qs.set('email', email);
    const response = await fetch('/.netlify/functions/get-es2-feedback-access?' + qs.toString(), { cache: 'no-store' });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  }
  function fillIdentity(payload) {
    el('prenom').value = payload.prenom || ''; el('email').value = payload.email || ''; state.token = payload.token || '';
    if (payload.token && !preview) { const url = new URL(location.href); url.searchParams.set('t', payload.token); history.replaceState({}, '', url.toString()); }
  }
  function success(firstName) {
    state.sent = true;
    el('success-title').textContent = 'Merci ' + (firstName || '') + '.';
    if (preview) el('success-message').textContent = 'Test terminé. Aucune réponse enregistrée, aucune notification envoyée.';
    show('screen-success');
  }
  el('form-submit').addEventListener('click', async () => {
    if (state.submitting || state.sent || !state.answers) return;
    el('form-error').textContent = '';
    if (!state.token) { el('form-error').textContent = 'Ton accès a expiré. Recharge la page pour te reconnecter.'; return; }
    if (preview) { success(el('prenom').value); return; }
    state.submitting = true; el('form-submit').disabled = true; el('es-edit').disabled = true;
    el('form-submit').textContent = 'Envoi en cours…';
    try {
      const response = await fetch('/.netlify/functions/submit-es2-feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: state.token, form_version: FEEDBACK_VERSION, answers: state.answers }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) { el('form-error').textContent = body.error || 'Impossible d’envoyer ton point personnel. Tes réponses sont conservées sur cette page.'; return; }
      success(body.prenom || el('prenom').value);
    } catch { el('form-error').textContent = 'Connexion interrompue. Tes réponses sont conservées sur cette page. Réessaie lorsque la connexion est rétablie.'; }
    finally { state.submitting = false; el('form-submit').disabled = false; el('es-edit').disabled = false; el('form-submit').textContent = 'Envoyer mon point personnel'; }
  });
  el('gate-form').addEventListener('submit', async event => {
    event.preventDefault(); if (el('gate-submit').disabled) return;
    el('gate-error').textContent = ''; const email = el('gate-email').value.trim().toLowerCase();
    if (!el('gate-email').checkValidity() || !email) { el('gate-error').textContent = 'Merci de saisir un email valide.'; return; }
    el('gate-submit').disabled = true;
    try {
      const access = await fetchAccess({ email });
      if (access.ok && access.body?.allowed) { fillIdentity(access.body); show('screen-form'); return; }
      el('gate-error').textContent = access.status === 403 ? 'Cette page est réservée aux membres ES 2.0' : access.status === 404 ? 'Aucun compte trouvé avec cet email' : 'Vérification impossible pour le moment.';
    } catch { el('gate-error').textContent = 'Vérification impossible pour le moment.'; }
    finally { el('gate-submit').disabled = false; }
  });
  async function bootstrap() {
    if (preview) { fillIdentity({ token: 'preview-dev-feedback', prenom: 'Sonny', email: 'preview@es2.local' }); el('es-preview-notice').hidden = false; show('screen-form'); return; }
    const params = new URLSearchParams(location.search); const token = (params.get('t') || params.get('token') || '').trim();
    if (!token) { show('screen-gate'); return; }
    try {
      const access = await fetchAccess({ token });
      if (access.ok && access.body?.allowed) { fillIdentity(access.body); show('screen-form'); return; }
      if (access.status === 403) el('gate-error').textContent = 'Cette page est réservée aux membres ES 2.0';
    } catch { el('gate-error').textContent = 'Vérification impossible pour le moment. Réessaie avec ton email.'; }
    show('screen-gate');
  }
  render();
  void bootstrap();
}
