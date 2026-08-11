import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';

function cleanCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{12}$/.test(code) ? code : '';
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

export default async (req) => {
  try {
    const url = new URL(req.url);
    const code = cleanCode(url.searchParams.get('code'));
    if (!code) return response(404, 'Lien invalide.');

    const uuidPrefix = `${code.slice(0, 8)}-*`;
    const jobs = await supabaseGet(
      `mc2_sms_jobs?id=like.${encodeURIComponent(uuidPrefix)}&message_type=eq.session_live&select=id,token&limit=20`,
    );
    if (!jobs.ok || !Array.isArray(jobs.data)) return response(503, 'Lien momentanément indisponible.');

    const matches = jobs.data.filter((job) => (
      String(job?.id || '').toLowerCase().replace(/[^a-f0-9]/g, '').startsWith(code)
    ));
    if (matches.length !== 1 || !matches[0]?.token) return response(404, 'Lien invalide.');

    const job = matches[0];
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
