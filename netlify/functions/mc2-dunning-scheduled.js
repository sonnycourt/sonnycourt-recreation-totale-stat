import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import { mc2DunningEnabled, processMc2DunningJob } from './lib/mc2-payment-recovery.mjs';

export default async () => {
  if (!mc2DunningEnabled()) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, enabled: false, processed: 0 }),
    };
  }

  const now = new Date();
  const staleClaimCutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
  await supabasePatch(
    'mc2_dunning_jobs',
    `status=eq.processing&last_attempt_at=lt.${encodeURIComponent(staleClaimCutoff)}`,
    { status: 'retry', last_error: 'processing_timeout' },
  );

  const jobs = await supabaseGet(
    `mc2_dunning_jobs?status=in.(pending,retry)&due_at=lte.${encodeURIComponent(now.toISOString())}&select=*&order=due_at.asc&limit=100`,
  );
  if (!jobs.ok) throw new Error(`mc2_dunning_jobs_${jobs.status}`);

  const results = [];
  for (const job of jobs.data || []) {
    results.push({ id: job.id, ...(await processMc2DunningJob(job, { now })) });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      enabled: true,
      processed: results.length,
      sent: results.filter((item) => item.status === 'sent').length,
      retried: results.filter((item) => item.status === 'retry').length,
      skipped: results.filter((item) => item.status === 'skipped').length,
      results,
    }),
  };
};
