const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const env = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');

async function probe(table, select) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!base || !key) return { ok: false, status: 'env_missing' };
  const response = await fetch(`${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  return { ok: response.ok, status: response.status };
}

const tables = {
  acceptances: await probe('mc2_contract_acceptances', 'id,evidence_sha256,payment_schedule'),
  attempts: await probe('mc2_payment_attempts', 'id,retry_sequence'),
  jobs: await probe('mc2_collection_case_jobs', 'id,retry_count,status'),
  cases: await probe('mc2_collection_cases', 'id,status,completeness,snapshot_sha256'),
  revisions: await probe('mc2_collection_case_revisions', 'id,revision'),
  audit: await probe('mc2_collection_case_audit', 'id,event_sha256'),
  billing: await probe('mc2_registrations', 'billing_full_name,billing_street,billing_zip,billing_city,billing_country'),
};
let expectedSchedule = [];
try {
  expectedSchedule = JSON.parse(String(env.MC2_CONTRACT_EXPECTED_SCHEDULE_JSON || ''));
} catch {}
const expectedEntry = Number(env.MC2_CONTRACT_EXPECTED_ENTRY_CENTS || 0);
const expectedTotal = Number(env.MC2_CONTRACT_EXPECTED_TOTAL_CENTS || 0);
const scheduleTotal = Array.isArray(expectedSchedule)
  ? expectedSchedule.reduce((total, item) => total + (Number(item?.amount_cents || 0) * Number(item?.installments || 1)), 0)
  : 0;
const summary = {
  supabase_migration_ready: Object.values(tables).every((result) => result.ok),
  supabase_checks: tables,
  preparation_enabled: String(env.MC2_COLLECTION_CASES_ENABLED || '').toLowerCase() === 'true',
  exports_enabled: String(env.MC2_COLLECTION_EXPORTS_ENABLED || '').toLowerCase() === 'true',
  contract_version_ready: Boolean(env.MC2_CONTRACT_VERSION),
  terms_snapshot_ready: Boolean(
    env.MC2_TERMS_URL
    && env.MC2_TERMS_SNAPSHOT_URL
    && /^[a-f0-9]{64}$/i.test(String(env.MC2_TERMS_SNAPSHOT_SHA256 || ''))
  ),
  contract_offer_guard_ready: Boolean(
    env.MC2_CONTRACT_EXPECTED_PAYMENT_PLAN
    && expectedEntry > 0
    && expectedTotal > 0
    && Array.isArray(expectedSchedule)
    && expectedSchedule.length > 0
    && Number(expectedSchedule[0]?.amount_cents || 0) === expectedEntry
    && scheduleTotal === expectedTotal
  ),
};
console.log(JSON.stringify(summary, null, 2));
// Avant activation, on attend le schéma et une version de contrat, mais les
// deux flags doivent justement rester false.
if (
  !summary.supabase_migration_ready
  || !summary.contract_version_ready
  || !summary.terms_snapshot_ready
  || !summary.contract_offer_guard_ready
) {
  process.exitCode = 1;
}
