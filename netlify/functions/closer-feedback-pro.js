import { supabasePost } from './lib/supabase-rest.mjs';

/**
 * /closer-feedback-pro : questionnaire de debrief payé des closers (fin de cycle).
 * Stocke la réponse complète dans Supabase (table closer_feedback_pro).
 */

const CLOSERS = ['Romain', 'Valentin', 'TEST'];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { ok: true });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const closer = typeof body.closer === 'string' ? body.closer.trim() : '';
    if (!CLOSERS.includes(closer)) return json(400, { error: 'Closer invalide' });

    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const clean = {};
    let filled = 0;
    for (const [k, v] of Object.entries(answers)) {
      if (typeof k !== 'string' || k.length > 20) continue;
      const val = typeof v === 'string' ? v.trim().slice(0, 8000) : '';
      clean[k] = val;
      if (val) filled++;
    }
    if (filled < 5) return json(400, { error: 'Réponds au moins aux questions principales avant d\'envoyer.' });

    const ins = await supabasePost('closer_feedback_pro', { closer, answers: clean });
    if (!ins.ok) {
      console.error('closer-feedback-pro insert error:', ins.status, ins.error);
      return json(500, { error: 'Enregistrement impossible, réessaie (ton brouillon est sauvegardé).' });
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error('closer-feedback-pro error:', error);
    return json(500, { error: 'Erreur serveur, réessaie.' });
  }
};
