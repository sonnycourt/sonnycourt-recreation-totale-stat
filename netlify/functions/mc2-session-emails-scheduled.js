import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  mc2OfferEmailsEnabled,
  mc2SessionEmailsEnabled,
  processMc2SessionEmailJob,
} from './lib/mc2-session-emails.mjs';
import { scheduledJson } from './lib/scheduled-response.mjs';

export default async () => {
  const sessionEmailsEnabled = mc2SessionEmailsEnabled();
  const offerEmailsEnabled = mc2OfferEmailsEnabled();
  if (!sessionEmailsEnabled && !offerEmailsEnabled) {
    return scheduledJson({ ok: true, enabled: false, processed: 0 });
  }
  const enabledTypes = [
    ...(sessionEmailsEnabled ? ['registration_confirmation', 'session_reminder_1h'] : []),
    ...(offerEmailsEnabled ? [
      'offer_followup_90m', 'offer_consultations_12h', 'offer_proof_36h',
      'offer_5_places', 'offer_4h', 'offer_1h',
    ] : []),
  ];
  const now = new Date();
  await supabasePatch(
    'mc2_session_email_jobs',
    `status=eq.processing&last_attempt_at=lt.${encodeURIComponent(new Date(now.getTime() - 5 * 60_000).toISOString())}`,
    { status: 'retry', last_error: 'processing_timeout' },
  );
  const jobs = await supabaseGet(
    `mc2_session_email_jobs?status=in.(pending,retry)&due_at=lte.${encodeURIComponent(now.toISOString())}`
      + `&message_type=in.(${enabledTypes.join(',')})`
      + '&select=*&order=due_at.asc&limit=100',
  );
  if (!jobs.ok) throw new Error(`mc2_session_email_jobs_${jobs.status}`);
  const results = [];
  for (const job of jobs.data || []) results.push({ id: job.id, ...(await processMc2SessionEmailJob(job, now)) });
  return scheduledJson({
    ok: true,
    enabled: true,
    sessionEmailsEnabled,
    offerEmailsEnabled,
    processed: results.length,
    results,
  });
};
