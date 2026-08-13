import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  mc2CircleEnabled,
  processMc2CircleOnboardingJob,
} from './lib/mc2-circle-onboarding.mjs';

export default async () => {
  if (!mc2CircleEnabled()) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, enabled: false, processed: 0 }) };
  }

  const now = new Date();
  const staleClaimCutoff = new Date(now.getTime() - 5 * 60_000).toISOString();
  await supabasePatch(
    'mc2_circle_onboarding_jobs',
    `status=eq.processing&last_attempt_at=lt.${encodeURIComponent(staleClaimCutoff)}`,
    {
      status: 'retry',
      next_attempt_at: now.toISOString(),
      last_error: 'processing_timeout',
      // A stale worker may have reached Circle after its last database write.
      // Clearing the local flags forces a fresh read of Circle; it still never
      // causes a second invite or a duplicate tag assignment.
      member_created: false,
      tag_added: false,
    },
  );
  const jobs = await supabaseGet(
    `mc2_circle_onboarding_jobs?status=in.(pending,retry)`
      + `&next_attempt_at=lte.${encodeURIComponent(now.toISOString())}`
      + '&select=*&order=next_attempt_at.asc&limit=50',
  );
  if (!jobs.ok) throw new Error(`mc2_circle_jobs_${jobs.status}`);

  const results = [];
  for (const job of jobs.data || []) {
    results.push({ id: job.id, ...(await processMc2CircleOnboardingJob(job, { now })) });
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      enabled: true,
      processed: results.length,
      succeeded: results.filter((item) => item.status === 'succeeded').length,
      retrying: results.filter((item) => item.status === 'retry').length,
      failed: results.filter((item) => item.status === 'failed').length,
      results,
    }),
  };
};
