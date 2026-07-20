import { getStore } from '@netlify/blobs';

/**
 * /closer-feedback-pro : questionnaire de debrief payé des closers (fin de cycle).
 * Stocke la réponse complète dans Netlify Blobs et notifie Sonny sur Telegram.
 */

const CLOSERS = ['Romain', 'Valentin', 'TEST'];

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function notifyTelegram(text) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4090),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
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

    const at = new Date().toISOString();
    const store = getStore('closer-feedback-pro');
    await store.set(
      `${closer.toLowerCase()}-${Date.now()}`,
      JSON.stringify({ closer, at, answers: clean }, null, 2),
    );

    if (closer !== 'TEST') {
      await notifyTelegram(
        `📋 <b>Debrief closer reçu : ${closer}</b>\n` +
        `${filled} réponses remplies.\n` +
        `Q7 (LE changement pour doubler les ventes) :\n« ${(clean.q7 || '').slice(0, 500)} »`,
      );
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error('closer-feedback-pro error:', error);
    return json(500, { error: 'Erreur serveur, réessaie.' });
  }
};
