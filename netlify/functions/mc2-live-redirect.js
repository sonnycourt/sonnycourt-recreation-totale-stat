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
  const marker = '/mc2-live-redirect/';
  const index = url.pathname.indexOf(marker);
  return index === -1 ? '' : cleanCode(decodeURIComponent(url.pathname.slice(index + marker.length)));
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const code = requestCode(url);
    if (!code) return response(404, 'Lien invalide.');

    const jobs = await supabaseGet(
      `mc2_sms_jobs?live_code=eq.${encodeURIComponent(code)}&message_type=eq.session_live&select=id,token&limit=2`,
    );
    if (!jobs.ok || !Array.isArray(jobs.data)) return response(503, 'Lien momentanément indisponible.');

    if (jobs.data.length !== 1 || !jobs.data[0]?.token) return response(404, 'Lien invalide.');

    const job = jobs.data[0];
    await supabasePost('mc2_funnel_events', {
      token: job.token,
      event_name: 'sms_live_link_clicked',
      event_value: code,
      page_path: `/live/${code}`,
      metadata: { sms_job_id: job.id, destination: '/mc2/session/' },
      dedupe_key: `sms_live_link_${job.id}_clicked`,
    }, { prefer: 'return=minimal' }).catch(() => {});

    const token = encodeURIComponent(job.token);
    return response(302, 'Redirection…', {
      Location: '/mc2/session/',
      'Set-Cookie': `mc2_registration_token=${token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
    });
  } catch (error) {
    console.error('mc2-live-redirect error:', error);
    return response(500, 'Lien momentanément indisponible.');
  }
};
