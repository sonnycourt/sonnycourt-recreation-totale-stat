import { loadMc2ReplayAccess, mc2ReplayRecoveryConfig } from './lib/mc2-replay-recovery.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Méthode non autorisée' });
  try {
    const access = new URL(req.url).searchParams.get('access');
    const result = await loadMc2ReplayAccess(access);
    if (!result.ok) return json(result.reason === 'expired' || result.reason === 'purchased' ? 410 : 404, { valid: false, reason: result.reason });
    const config = mc2ReplayRecoveryConfig();
    if (!config.replayUrl) return json(503, { valid: false, reason: 'video_not_configured' });
    return json(200, {
      valid: true,
      firstName: result.registration.prenom || '',
      expiresAt: result.expires.toISOString(),
      resumeSeconds: Number(result.job.resume_seconds || 0),
      videoUrl: config.replayUrl,
      ctaSeconds: config.replayCtaSeconds,
      offerUrl: `/.netlify/functions/mc2-replay-offer?access=${encodeURIComponent(access)}`,
    });
  } catch (error) {
    console.error('mc2-replay-access:', error);
    return json(500, { error: 'Accès momentanément indisponible' });
  }
};
