import { loadMc2RecoveryAccess } from './lib/mc2-replay-recovery.mjs';
import { supabasePost } from './lib/supabase-rest.mjs';

function response(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers },
  });
}

export default async (req) => {
  try {
    const accessCode = new URL(req.url).searchParams.get('access');
    const result = await loadMc2RecoveryAccess(accessCode);
    if (!result.ok) return response(result.reason === 'expired' ? 410 : 404, 'Lien expiré ou invalide.');
    await supabasePost('mc2_funnel_events', {
      token: result.registration.token,
      event_name: 'cta_clicked',
      event_value: 'replay_recovery',
      page_path: '/mc2/replay/',
      metadata: { route: '/commencer/', button_id: 'mc2-replay-offer' },
      dedupe_key: `replay_recovery_cta_${result.job.id}`,
    }, { prefer: 'return=minimal' }).catch(() => {});
    const token = encodeURIComponent(result.registration.token);
    return response(302, 'Redirection…', {
      Location: '/commencer/',
      'Set-Cookie': `mc2_registration_token=${token}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    });
  } catch (error) {
    console.error('mc2-replay-offer:', error);
    return response(500, 'Lien momentanément indisponible.');
  }
};
