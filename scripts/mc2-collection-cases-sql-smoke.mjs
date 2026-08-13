import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create table public.mc2_registrations (
    token text primary key,
    email text,
    created_at timestamptz not null default now()
  );
`);

const migration = await fs.readFile(new URL('../sql/mc2_collection_cases.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);

await db.exec(`
  insert into public.mc2_registrations(token, email)
  values ('mc2-sql-test', 'client@example.test');

  insert into public.mc2_contract_acceptances(
    token, stripe_checkout_session_id, contract_version, terms_url,
    terms_snapshot_url, terms_snapshot_sha256, acceptance_text, payment_plan, payment_schedule,
    initial_payment_cents, contractual_total_cents, currency, accepted_at,
    evidence_sha256
  ) values (
    'mc2-sql-test', 'cs_test_sql', 'v1', 'https://example.test/cgv',
    'https://example.test/cgv-v1.pdf', repeat('a', 64), 'Accepté', '47_then_4x297_days_14_35_56_77',
    '[{"label":"Acompte","amount_cents":4700}]'::jsonb,
    4700, 123500, 'eur', now(), repeat('b', 64)
  );

  insert into public.mc2_collection_case_jobs(
    token, stripe_invoice_id, job_key, retry_count
  ) values ('mc2-sql-test', 'in_sql', 'mc2_collection:in_sql:r5', 5);

  insert into public.mc2_collection_cases(
    case_number, token, stripe_invoice_id, status, currency,
    contractual_total_cents, paid_total_cents, balance_due_cents,
    overdue_invoice_cents, automatic_retry_count, completeness, snapshot,
    snapshot_sha256, prepared_at, ready_for_review_at
  ) values (
    'MC2-INSQL', 'mc2-sql-test', 'in_sql', 'ready_for_review', 'eur',
    123500, 4700, 118800, 29700, 5, '{"complete":true}'::jsonb,
    '{"schema_version":"mc2-collection-case-v1"}'::jsonb,
    repeat('c', 64), now(), now()
  );
`);

const caseRow = (await db.query("select * from public.review_mc2_collection_case(1, 'approve', 'ready_for_review', 'sql-smoke', null, $1)", ['d'.repeat(64)])).rows[0];
assert.equal(caseRow.status, 'approved');
assert.equal((await db.query("select count(*)::integer as count from public.mc2_collection_case_audit where event_type = 'human_approved'")).rows[0].count, 1);

await assert.rejects(
  () => db.query("update public.mc2_contract_acceptances set acceptance_text = 'altéré' where id = 1"),
  /append-only/,
);
await assert.rejects(
  () => db.query("insert into public.mc2_collection_case_jobs(token, stripe_invoice_id, job_key, retry_count) values ('mc2-sql-test', 'in_bad', 'bad', 6)"),
  /check constraint/,
);

console.log(JSON.stringify({
  migration_idempotent: 'ok',
  immutable_evidence: 'ok',
  exact_five_retry_constraint: 'ok',
  atomic_human_review_and_audit: 'ok',
}, null, 2));
