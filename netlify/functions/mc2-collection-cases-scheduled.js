import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import { mc2CollectionEnabled, prepareMc2CollectionCase } from './lib/mc2-collection-case.mjs';
import { scheduledJson } from './lib/scheduled-response.mjs';

export default async () => {
  if (!mc2CollectionEnabled()) {
    return scheduledJson({ ok: true, enabled: false, processed: 0 });
  }
  const now = new Date();
  const stale = new Date(now.getTime() - 15 * 60_000).toISOString();
  await supabasePatch(
    'mc2_collection_case_jobs',
    `status=eq.processing&last_attempt_at=lt.${encodeURIComponent(stale)}`,
    { status: 'retry', last_error: 'processing_timeout' },
  );
  const jobs = await supabaseGet(
    `mc2_collection_case_jobs?status=in.(pending,retry)&retry_count=eq.5`
      + `&due_at=lte.${encodeURIComponent(now.toISOString())}&select=*&order=due_at.asc&limit=25`,
  );
  if (!jobs.ok) throw new Error(`mc2_collection_jobs_${jobs.status}`);
  const results = [];
  for (const job of jobs.data || []) {
    results.push({ id: job.id, ...(await prepareMc2CollectionCase(job, { now })) });
  }
  return scheduledJson({
    ok: true,
    enabled: true,
    processed: results.length,
    completed: results.filter((item) => item.status === 'completed').length,
    needs_retry: results.filter((item) => item.status === 'retry').length,
    results,
  });
};
