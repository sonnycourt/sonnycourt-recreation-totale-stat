import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';
import { mc2EntryPaymentPending } from '../../src/lib/mc2-entry-payment.mjs';
import { MC2_SURVEY_VERSION, validSurveyPatch, surveyAnswers, mc2SurveyOpen } from '../../src/lib/mc2-survey.mjs';

const json = (status, body) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée.' });
  // No real questionnaire data or writes in local/dev/branch previews.
  if (process.env.CONTEXT !== 'production' || process.env.NETLIFY_DEV === 'true') {
    return json(403, { error: 'Questionnaire désactivé en preview.' });
  }
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json(403, { error: 'Origine invalide.' });
  if (!req.headers.get('content-type')?.startsWith('application/json')) return json(415, { error: 'JSON requis.' });

  try {
    const raw = await req.text();
    if (raw.length > 2048) return json(413, { error: 'Requête trop volumineuse.' });
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON invalide.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Requête invalide.' });
    const { token, sessionGeneration, action, answers, surveyVersion } = body;
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(token)
      || !Number.isSafeInteger(sessionGeneration) || sessionGeneration < 0
      || surveyVersion !== MC2_SURVEY_VERSION || !['load', 'save'].includes(action)
      || (action === 'save' && !validSurveyPatch(answers))) return json(400, { error: 'Réponses invalides.' });

    const encoded = encodeURIComponent(token);
    const [registration, test] = await Promise.all([
      supabaseGet(`mc2_registrations?token=eq.${encoded}&select=id,session_generation,session_starts_at,registration_completed_at,statut,entry_payment_required,entry_payment_paid_at&limit=1`),
      supabaseGet(`mc2_tracking_test_registrations?token=eq.${encoded}&select=token&limit=1`),
    ]);
    if (!registration.ok || !test.ok) return json(503, { error: 'Enregistrement temporairement indisponible.' });
    const row = registration.data?.[0];
    if (!row) return json(404, { error: 'Inscription introuvable.' });
    if (test.data?.length || mc2EntryPaymentPending(row) || !row.registration_completed_at) {
      return json(403, { error: 'Inscription non éligible.' });
    }
    if (row.session_generation !== sessionGeneration) return json(409, { error: 'Ta session a changé. Recharge la page.' });
    const query = `registration_id=eq.${row.id}&session_generation=eq.${sessionGeneration}&survey_version=eq.${MC2_SURVEY_VERSION}`;
    if (action === 'load') {
      const result = await supabaseGet(`mc2_survey_responses?${query}&select=priority,familiarity,profession,urgency,completed_at&limit=1`);
      if (!result.ok) return json(503, { error: 'Lecture temporairement indisponible.' });
      return json(200, { answers: surveyAnswers(result.data?.[0]), completed: Boolean(result.data?.[0]?.completed_at) });
    }
    if (!mc2SurveyOpen(row.session_starts_at)) return json(410, { error: 'Le questionnaire est terminé.' });
    // Upsert only supplied answer columns: concurrent answers to other questions
    // must not be erased. Identity/session/date always come from the server.
    const result = await supabasePost(
      'mc2_survey_responses?on_conflict=registration_id,session_generation,survey_version',
      { registration_id: row.id, session_generation: row.session_generation,
        survey_version: MC2_SURVEY_VERSION, session_starts_at: row.session_starts_at, ...answers },
      { prefer: 'resolution=merge-duplicates,return=minimal' },
    );
    if (!result.ok) return json(503, { error: 'Enregistrement temporairement indisponible.' });
    return json(200, { saved: true });
  } catch {
    // Do not log tokens or questionnaire answers.
    return json(503, { error: 'Enregistrement temporairement indisponible.' });
  }
}
