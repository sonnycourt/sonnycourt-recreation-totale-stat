import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';

function cleanCode(value) {
  const code = String(value || '').trim();
  return /^[A-Za-z0-9]{5}$/.test(code) ? code : '';
}

function response(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}

function requestCode(url) {
  const queryCode = cleanCode(url.searchParams.get('code'));
  if (queryCode) return queryCode;
  const segment = url.pathname.split('/').filter(Boolean).at(-1) || '';
  return cleanCode(decodeURIComponent(segment));
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const code = requestCode(url);
    if (!code) return response(404, 'Lien invalide.');

    const jobs = await supabaseGet(
      `mc2_sms_jobs?live_code=eq.${encodeURIComponent(code)}&select=id,token,message_type&limit=2`,
    );
    if (!jobs.ok || !Array.isArray(jobs.data)) return response(503, 'Lien momentanément indisponible.');
    if (jobs.data.length !== 1 || !jobs.data[0]?.token) return response(404, 'Lien invalide.');

    const job = jobs.data[0];
    const registrations = await supabaseGet(
      `mc2_registrations?token=eq.${encodeURIComponent(job.token)}`
        + '&select=token,statut,payment_status,offer_expires_at&limit=2',
    );
    if (!registrations.ok || !Array.isArray(registrations.data)) {
      return response(503, 'Lien momentanément indisponible.');
    }
    if (registrations.data.length !== 1 || !registrations.data[0]?.token) {
      return response(404, 'Lien invalide.');
    }
    const registration = registrations.data[0];
    const expiresAt = new Date(registration.offer_expires_at || '').getTime();
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      return response(410, 'Cette offre a expiré.');
    }

    await supabasePost('mc2_funnel_events', {
      token: job.token,
      event_name: 'sms_offer_link_clicked',
      event_value: null,
      page_path: `/offre/${code}`,
      metadata: { sms_job_id: job.id, destination: '/mc2/session/' },
      dedupe_key: `sms_offer_link_${job.id}_clicked`,
    }, { prefer: 'return=minimal' }).catch(() => {});

    const token = encodeURIComponent(job.token);
    const purchased = registration.statut === 'purchased' || registration.payment_status === 'paid';
    return response(302, 'Redirection…', {
      Location: purchased
        ? `/commencer/succes/?provider=spiffy&t=${token}`
        : `/mc2/session/?t=${token}`,
      'Set-Cookie': `mc2_registration_token=${token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
    });
  } catch (error) {
    console.error('mc2-offer-redirect error:', error);
    return response(500, 'Lien momentanément indisponible.');
  }
};
