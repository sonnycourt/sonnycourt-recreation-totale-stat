import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';

const MAILERLITE_API_BASE = 'https://connect.mailerlite.com/api';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

function toBool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function isEs2Buyer(row) {
  return toBool(row?.es_purchased) || toBool(row?.purchased);
}

function buildEmailPayload({
  prenom,
  email,
  moduleReached,
  dailyPractice,
  whatChanged,
  biggestWin,
  whatBlocks,
  helpNeeded,
  score,
}) {
  const subject = `Bilan J+30 — ${prenom || 'Sans prénom'}`;
  const body = [
    `Prénom : ${prenom || ''}`,
    `Email : ${email || ''}`,
    `Module atteint : ${moduleReached || ''}`,
    `Exercices quotidiens : ${dailyPractice || ''}`,
    `Ce qui a changé : ${whatChanged || ''}`,
    `Plus grand déclic : ${biggestWin || ''}`,
    `Ce qui bloque : ${whatBlocks || ''}`,
    `Aide demandée : ${helpNeeded || ''}`,
    `Score : ${score}/10`,
  ].join('\n');
  return { subject, body };
}

async function sendFeedbackEmailFireAndForget(payload) {
  const apiKey = String(process.env.MAILERLITE_API_KEY || '').trim();
  if (!apiKey) return;

  const senderEmail = String(process.env.ES2_FEEDBACK_FROM_EMAIL || 'info@sonnycourt.com').trim();
  const senderName = String(process.env.ES2_FEEDBACK_FROM_NAME || 'ES2 Feedback').trim();

  const recipients = [{ email: 'info@sonnycourt.com' }];
  const commonHeaders = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const bodyText = payload.body;

  // MailerLite endpoints vary by account/product. Try both quietly.
  const attempts = [
    {
      url: `${MAILERLITE_API_BASE}/transactional-emails`,
      data: {
        from: { email: senderEmail, name: senderName },
        to: recipients,
        subject: payload.subject,
        text: bodyText,
      },
    },
    {
      url: `${MAILERLITE_API_BASE}/messages`,
      data: {
        from: senderEmail,
        from_name: senderName,
        to: 'info@sonnycourt.com',
        subject: payload.subject,
        text: bodyText,
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: commonHeaders,
        body: JSON.stringify(attempt.data),
      });
      if (res.ok) return;
      const err = await res.text().catch(() => '');
      console.warn('submit-es2-feedback mail send failed:', attempt.url, res.status, err);
    } catch (error) {
      console.warn('submit-es2-feedback mail send error:', attempt.url, error?.message || error);
    }
  }
}

async function fetchRegistrationByToken(token) {
  const withEsPurchased = await supabaseGet(
    `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=token,email,prenom,es_purchased,purchased&limit=1`,
  );
  if (withEsPurchased.ok && Array.isArray(withEsPurchased.data)) {
    return withEsPurchased;
  }
  const fallback = await supabaseGet(
    `webinaire_registrations?token=eq.${encodeURIComponent(token)}&select=token,email,prenom,purchased&limit=1`,
  );
  if (fallback.ok && Array.isArray(fallback.data)) {
    const row = fallback.data[0];
    return {
      ...fallback,
      data: row ? [{ ...row, es_purchased: row.purchased }] : [],
    };
  }
  return withEsPurchased.ok ? fallback : withEsPurchased;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json();
    const token = String(body?.token || '').trim();
    const moduleReached = String(body?.module_reached || '').trim();
    const dailyPractice = String(body?.daily_practice || '').trim();
    const whatChanged = String(body?.what_changed || '').trim();
    const biggestWin = String(body?.biggest_win || '').trim();
    const whatBlocks = String(body?.what_blocks || '').trim();
    const helpNeeded = String(body?.help_needed || '').trim();
    const score = Number(body?.score);

    if (!token) return jsonResponse(400, { error: 'Token requis' });
    if (!moduleReached) return jsonResponse(400, { error: 'Module requis' });
    if (!dailyPractice) return jsonResponse(400, { error: 'daily_practice requis' });
    if (!whatChanged) return jsonResponse(400, { error: 'what_changed requis' });
    if (!whatBlocks) return jsonResponse(400, { error: 'what_blocks requis' });
    if (!helpNeeded) return jsonResponse(400, { error: 'help_needed requis' });
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      return jsonResponse(400, { error: 'Score invalide' });
    }

    const reg = await fetchRegistrationByToken(token);
    if (!reg.ok) {
      console.error('submit-es2-feedback registration query failed:', reg.status, reg.error);
      return jsonResponse(500, { error: 'Erreur serveur' });
    }
    const row = Array.isArray(reg.data) ? reg.data[0] : null;
    if (!row) return jsonResponse(404, { error: 'Inscription introuvable' });
    if (!isEs2Buyer(row)) {
      return jsonResponse(403, { error: 'Cette page est réservée aux membres ES 2.0' });
    }

    const insert = await supabasePost(
      'es2_feedback',
      {
        token: row.token,
        email: row.email || '',
        prenom: row.prenom || '',
        module_reached: moduleReached,
        daily_practice: dailyPractice,
        what_changed: whatChanged,
        biggest_win: biggestWin || null,
        what_blocks: whatBlocks,
        help_needed: helpNeeded,
        score,
      },
      { prefer: 'return=minimal' },
    );

    if (!insert.ok) {
      console.error('submit-es2-feedback insert failed:', insert.status, insert.error);
      return jsonResponse(500, {
        error: 'Impossible d’enregistrer le bilan',
        details: process.env.NETLIFY_DEV ? insert.error : undefined,
      });
    }

    const emailPayload = buildEmailPayload({
      prenom: row.prenom || '',
      email: row.email || '',
      moduleReached,
      dailyPractice,
      whatChanged,
      biggestWin,
      whatBlocks,
      helpNeeded,
      score,
    });
    void sendFeedbackEmailFireAndForget(emailPayload);

    return jsonResponse(200, {
      success: true,
      prenom: row.prenom || '',
      message: `Merci ${row.prenom || ''}. Je reviens vers toi personnellement dans les prochains jours.`,
    });
  } catch (error) {
    console.error('submit-es2-feedback error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error.message : undefined,
    });
  }
};
