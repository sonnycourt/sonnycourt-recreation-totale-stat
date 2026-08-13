const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdinEnv = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
const env = { ...process.env, ...stdinEnv };

const requiredGroups = [
  ...Array.from({ length: 6 }, (_, index) => `MAILERLITE_GROUP_MC2_PAYMENT_FAILED_${index + 1}`),
  'MAILERLITE_GROUP_MC2_PAYMENT_ACTION_REQUIRED',
  'MAILERLITE_GROUP_MC2_PAYMENT_FINAL_FAILED',
];

async function supabaseProbe(table, select) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!base || !key) return { ok: false, status: 'env_missing' };
  const response = await fetch(
    `${base}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    },
  );
  return { ok: response.ok, status: response.status };
}

const [recoveries, jobs, registrationColumns] = await Promise.all([
  supabaseProbe('mc2_payment_recoveries', 'stripe_invoice_id'),
  supabaseProbe('mc2_dunning_jobs', 'id'),
  supabaseProbe(
    'mc2_registrations',
    'payment_retry_count,payment_next_retry_at,payment_failure_code,payment_exhausted_at',
  ),
]);

const summary = {
  supabase_migration_ready: recoveries.ok && jobs.ok && registrationColumns.ok,
  supabase_checks: { recoveries, jobs, registrationColumns },
  mailerlite_api_key_ready: Boolean(env.MAILERLITE_API_KEY),
  mailerlite_groups_ready: requiredGroups.every((name) => Boolean(env[name])),
  dunning_enabled: String(env.MC2_DUNNING_ENABLED || '').toLowerCase() === 'true',
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.supabase_migration_ready || !summary.mailerlite_api_key_ready || !summary.mailerlite_groups_ready) {
  process.exitCode = 1;
}
