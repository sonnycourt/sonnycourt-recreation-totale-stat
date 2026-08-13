import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  mc2ContractDocumentEmailsEnabled,
  processMc2ContractDocumentEmail,
} from './lib/mc2-contract-document-email.mjs';

export default async () => {
  if (!mc2ContractDocumentEmailsEnabled()) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, enabled: false, processed: 0 }) };
  }
  const now = new Date();
  await supabasePatch(
    'mc2_contract_documents',
    `notification_status=eq.processing&notification_last_attempt_at=lt.${encodeURIComponent(new Date(now.getTime() - 5 * 60_000).toISOString())}`,
    { notification_status: 'retry', notification_last_error: 'processing_timeout' },
  );
  const jobs = await supabaseGet(
    `mc2_contract_documents?notification_status=in.(pending,retry)`
      + `&notification_due_at=lte.${encodeURIComponent(now.toISOString())}`
      + '&select=id,registration_token,access_token,purchased_at,notification_status,notification_due_at,notification_attempts'
      + '&order=notification_due_at.asc&limit=100',
  );
  if (!jobs.ok) throw new Error(`mc2_contract_document_jobs_${jobs.status}`);
  const results = [];
  for (const job of jobs.data || []) {
    results.push({ id: job.id, ...(await processMc2ContractDocumentEmail(job, now)) });
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, enabled: true, processed: results.length, results }),
  };
};

