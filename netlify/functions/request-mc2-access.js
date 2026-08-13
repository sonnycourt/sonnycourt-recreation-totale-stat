import { supabaseGet } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const genericResponse = () => jsonResponse(200, {
  ok: true,
  message: 'Si cette adresse correspond à une inscription, ton lien d’accès vient d’être envoyé.',
});

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
    const allowedPaths = new Set(['/commencer/', '/mc2/confirmation/', '/mc2/session/']);
    const pagePath = allowedPaths.has(String(body?.page_path || '')) ? String(body.page_path) : '/mc2/confirmation/';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(400, { error: 'Entre une adresse email valide.' });
    }

    const result = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}&select=token,prenom&order=registered_at.desc&limit=1`,
    );
    const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
    if (!row?.token) return genericResponse();

    const apiKey = String(process.env.MAILERSEND_API_KEY || '').trim();
    const senderEmail = String(process.env.PAY_EMAIL_FROM || process.env.COACHING_EMAIL_FROM || 'info@sonnycourt.com').trim();
    if (!apiKey || !senderEmail) {
      console.error('request-mc2-access: MailerSend non configuré');
      return jsonResponse(503, { error: 'L’envoi du lien est momentanément indisponible. Contacte le support.' });
    }

    const deployedUrl = process.env.CONTEXT === 'production'
      ? process.env.URL
      : (process.env.DEPLOY_PRIME_URL || process.env.URL);
    const siteUrl = String(deployedUrl || 'https://sonnycourt.com').replace(/\/$/, '');
    const accessUrl = `${siteUrl}${pagePath}?t=${encodeURIComponent(row.token)}`;
    const firstName = String(row.prenom || '').trim();
    const safeName = escapeHtml(firstName || '');
    const safeUrl = escapeHtml(accessUrl);
    const response = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: senderEmail, name: process.env.PAY_EMAIL_FROM_NAME || 'Sonny Court' },
        to: [{ email, name: firstName || undefined }],
        subject: 'Ton lien d’accès à la masterclass',
        text: `${firstName ? `Bonjour ${firstName},\n\n` : ''}Voici ton lien personnel pour reprendre ton parcours :\n${accessUrl}\n\nSonny`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a"><p>${safeName ? `Bonjour ${safeName},` : 'Bonjour,'}</p><p>Voici ton lien personnel pour reprendre ton parcours :</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:15px 22px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">REPRENDRE MON PARCOURS</a></p><p style="font-size:13px;color:#64748b">Ce lien est personnel. Ne le partage pas.</p><p>Sonny</p></div>`,
      }),
    });
    if (!response.ok) {
      console.error('request-mc2-access MailerSend:', response.status, await response.text().catch(() => ''));
      return jsonResponse(503, { error: 'L’envoi du lien est momentanément indisponible. Contacte le support.' });
    }

    return genericResponse();
  } catch (error) {
    console.error('request-mc2-access error:', error);
    return genericResponse();
  }
};
