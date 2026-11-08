import { MC2_SURVEY_VERSION } from './mc2-survey.mjs';

// Dedicated queue: no dependency on video playback or Meta event delivery.
export function createSurveySync({ token, sessionGeneration, preview, onLoad, onStatus,
  fetcher = (...args) => fetch(...args), schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false, loaded = false, busy = false, attempts = 0, timer, controller;
  let pending = {};
  const status = (message, retry = false) => { if (!stopped) onStatus(message, retry); };
  async function request(action, answers) {
    controller = new AbortController();
    const timeout = schedule(() => controller?.abort(), 8000);
    try {
      const response = await fetcher('/.netlify/functions/mc2-survey', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({ token, sessionGeneration, surveyVersion: MC2_SURVEY_VERSION, action, ...(answers ? { answers } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'Enregistrement indisponible.'), { status: response.status });
      return data;
    } finally { cancel(timeout); }
  }
  async function run() {
    if (stopped || busy || preview) return;
    busy = true;
    try {
      if (!loaded) {
        status('Chargement de tes réponses…');
        const data = await request('load');
        if (stopped) return;
        loaded = true;
        onLoad(data.answers || {}, data.completed === true);
      }
      while (!stopped && Object.keys(pending).length) {
        const patch = { ...pending };
        status('Enregistrement…');
        await request('save', patch);
        if (stopped) return;
        for (const [key, value] of Object.entries(patch)) {
          if (pending[key] === value) delete pending[key];
        }
      }
      attempts = 0;
      status('');
    } catch (error) {
      if (stopped) return;
      const permanent = [400, 403, 404, 409, 410].includes(error.status);
      if (!permanent && attempts < 3) {
        status('Connexion interrompue. Nouvelle tentative…');
        timer = schedule(() => { timer = undefined; run(); }, [2000, 5000, 10000][attempts++]);
      } else {
        status(permanent ? error.message : 'Tes réponses ne sont pas encore enregistrées.', !permanent);
      }
    } finally { busy = false; }
  }
  if (preview) { loaded = true; onLoad({}, false); } else { void run(); }
  return {
    save(key, value) {
      if (stopped || preview) return;
      pending[key] = value;
      if (!timer) void run();
    },
    retry() { cancel(timer); timer = undefined; attempts = 0; void run(); },
    dispose() { stopped = true; cancel(timer); controller?.abort(); },
  };
}
