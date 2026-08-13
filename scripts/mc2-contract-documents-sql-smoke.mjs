import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create table public.mc2_registrations (token text primary key);
`);

const migration = await fs.readFile(new URL('../sql/mc2_contract_documents.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration);

const snapshot = {
  schema_version: 'mc2-contract-document-v1',
  verified_paid_at_creation: true,
  product: { key: 'esprit-subconscient-2' },
  pricing: { total_cents: 123500, paid_at_purchase_cents: 4700 },
  schedule: [{ due_offset_days: 0 }, { due_offset_days: 14 }, { due_offset_days: 35 }, { due_offset_days: 56 }, { due_offset_days: 77 }],
};
await db.query('insert into public.mc2_registrations(token) values ($1)', ['registration-token']);
await db.query(`
  insert into public.mc2_contract_documents(
    registration_token, access_token, access_token_hash, document_reference,
    product_key, source_stripe_event_id, purchased_at, snapshot, rendered_html
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`, [
  'registration-token', 'opaque-access-token', 'a'.repeat(64), 'MC2-20260813-SQLTEST',
  'esprit-subconscient-2', 'evt_sql_test', '2026-08-13T12:00:00Z', JSON.stringify(snapshot),
  '<!doctype html><p>Frozen</p>',
]);

await assert.rejects(
  () => db.query("update public.mc2_contract_documents set snapshot = '{}'::jsonb where id = 1"),
  /immutable/,
);
await assert.rejects(
  () => db.query(`
    insert into public.mc2_contract_documents(
      registration_token, access_token, access_token_hash, document_reference,
      product_key, source_stripe_event_id, purchased_at, snapshot, rendered_html
    ) values ('registration-token', 'other', $1, 'OTHER', 'esprit-subconscient-2', 'evt_other', now(), '{}', '<!doctype html>')
  `, ['b'.repeat(64)]),
  /unique constraint/,
);
await db.query("update public.mc2_contract_documents set notification_status = 'delivered' where id = 1");
const row = (await db.query('select notification_status, snapshot from public.mc2_contract_documents where id = 1')).rows[0];
assert.equal(row.notification_status, 'delivered');
assert.equal(row.snapshot.pricing.total_cents, 123500);
await assert.rejects(
  () => db.query("update public.mc2_contract_documents set rendered_html = '<!doctype html>changed' where id = 1"),
  /immutable/,
);

console.log(JSON.stringify({
  migration_idempotent: 'ok',
  immutable_snapshot: 'ok',
  duplicate_registration_guard: 'ok',
  notification_state_only_mutation: 'ok',
}, null, 2));
