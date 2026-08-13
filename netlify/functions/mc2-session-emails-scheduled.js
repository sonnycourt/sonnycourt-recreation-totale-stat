import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import { mc2SessionEmailsEnabled, processMc2SessionEmailJob } from './lib/mc2-session-emails.mjs';

export default async () => {
  if (!mc2SessionEmailsEnabled()) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, enabled: false, processed: 0 }) };
  }
  const now = new Date();
  await supabasePatch(
    'mc2_session_email_jobs',
    `status=eq.processing&last_attempt_at=lt.${encodeURIComponent(new Date(now.getTime() - 5 * 60_000).toISOString())}`,
    { status: 'retry', last_error: 'processing_timeout' },
  );
  const jobs = await supabaseGet(
    `mc2_session_email_jobs?status=in.(pending,retry)&due_at=lte.${encodeURIComponent(now.toISOString())}`
      + '&select=*&order=due_at.asc&limit=100',
  );
  if (!jobs.ok) throw new Error(`mc2_session_email_jobs_${jobs.status}`);
  const results = [];
  for (const job of jobs.data || []) results.push({ id: job.id, ...(await processMc2SessionEmailJob(job, now)) });
  return { statusCode: 200, body: JSON.stringify({ ok: true, enabled: true, processed: results.length, results }) };
};
