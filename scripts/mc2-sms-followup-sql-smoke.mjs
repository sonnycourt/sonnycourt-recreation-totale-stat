import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// In-memory PostgreSQL only. Never connects to Supabase.
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.mc2_registrations (
      token text PRIMARY KEY, telephone text, statut text, payment_status text,
      purchased_at timestamptz, offer_expires_at timestamptz
    );
  `);
  for (const name of ['mc2_sms.sql', 'mc2_tracking_v2.sql']) {
    await db.exec(await readFile(new URL(`../sql/${name}`, import.meta.url), 'utf8'));
  }
  const migration = await readFile(new URL('../sql/mc2_offer_followup_sms.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const now = '2026-09-27T14:00:00Z';
  const queue = async (at = now) => (await db.query('SELECT public.queue_mc2_offer_followup_sms($1) AS n', [at])).rows[0].n;
  const event = async (token, at, name = 'offer_visible', route = '/mc2/session/') => db.query(`
    INSERT INTO public.mc2_tracking_events_v2
      (event_id, token, event_name, client_occurred_at, received_at, visit_id, route, webinar_version, offer_version)
    VALUES ($1, $2, $3, $4, $4, $5, $6, 'test', 'test')
  `, [randomUUID(), token, name, at, randomUUID(), route]);
  const add = async (token, at = '2026-09-27T12:00:00Z', name = 'offer_visible') => {
    await db.query(`INSERT INTO public.mc2_registrations
      (token, telephone, statut, sms_consent_at, offer_expires_at)
      VALUES ($1, '+41790000000', 'registered', '2026-09-27T10:00:00Z', '2026-09-30T14:00:00Z')`, [token]);
    await event(token, at, name);
  };

  await add('eligible');
  await event('eligible', '2026-09-27T12:00:30Z', 'offer_visible', '/mc2/replay/');
  await add('nine-minutes-late', '2026-09-27T11:51:00Z');
  await add('too-early', '2026-09-27T12:01:00Z');
  await add('too-late', '2026-09-27T11:49:00Z');
  await add('repeat-not-first', '2026-09-26T12:00:00Z');
  await event('repeat-not-first', '2026-09-27T12:00:00Z');
  await add('available-only', '2026-09-27T12:00:00Z', 'offer_available');
  await add('legacy-cta-only', '2026-09-27T12:00:00Z', 'cta_reached');
  await add('test');
  await db.exec("INSERT INTO public.mc2_tracking_test_registrations(token, reason) VALUES ('test', 'smoke')");
  const exclusions = {
    paid: "payment_status='paid'", active: "payment_status='active'", succeeded: "payment_status='succeeded'",
    complete: "payment_status='complete'", completed: "payment_status='completed'",
    purchased: "statut='purchased'", 'purchased-date': "purchased_at='2026-09-27T13:00:00Z'",
    'no-consent': 'sms_consent_at=NULL', 'no-phone': "telephone='  '",
    expired: "offer_expires_at='2026-09-27T13:59:59Z'", 'no-expiry': 'offer_expires_at=NULL',
  };
  for (const [token, change] of Object.entries(exclusions)) {
    await add(token);
    await db.query(`UPDATE public.mc2_registrations SET ${change} WHERE token=$1`, [token]);
  }
  await add('webhook-cancelled');
  await db.exec(`INSERT INTO public.mc2_sms_jobs(token, job_key, message_type, due_at, status, skip_reason)
    VALUES ('webhook-cancelled', 'old-deadline', 'offer_deadline', '2026-09-29T10:00:00Z', 'skipped', 'spiffy_purchase_completed')`);
  const before = JSON.stringify((await db.query('SELECT * FROM public.mc2_registrations ORDER BY token')).rows);
  const trackingCount = (await db.query('SELECT count(*) AS n FROM public.mc2_tracking_events_v2')).rows[0].n;
  assert.equal(await queue(), 2);
  const jobs = (await db.query("SELECT token, due_at, job_key FROM public.mc2_sms_jobs WHERE message_type='offer_followup' ORDER BY token")).rows;
  assert.deepEqual(jobs.map(r => r.token), ['eligible', 'nine-minutes-late']);
  assert.equal(new Date(jobs[0].due_at).toISOString(), '2026-09-27T14:00:00.000Z');
  assert.equal(jobs[0].job_key, 'offer_followup:eligible');
  assert.equal(await queue(), 0, 'repeated scheduler does not duplicate or reschedule');
  await db.exec("UPDATE public.mc2_sms_jobs SET status='sent' WHERE token='eligible'");
  assert.equal(await queue(), 0, 'sent job is never requeued');
  assert.equal(await queue('2026-09-27T14:01:00Z'), 1, 'the next due first-view becomes eligible');
  assert.equal(JSON.stringify((await db.query('SELECT * FROM public.mc2_registrations ORDER BY token')).rows), before);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.mc2_tracking_events_v2')).rows[0].n, trackingCount);
  assert.equal((await db.query("SELECT skip_reason FROM public.mc2_sms_jobs WHERE job_key='old-deadline'")).rows[0].skip_reason, 'spiffy_purchase_completed');
  await assert.rejects(() => db.exec(`INSERT INTO public.mc2_sms_jobs(token, job_key, message_type, due_at)
    VALUES ('eligible', 'duplicate-other-key', 'offer_followup', now())`), /unique constraint/);
  await assert.rejects(() => db.exec(`INSERT INTO public.mc2_sms_jobs(token, job_key, message_type, due_at)
    VALUES ('eligible', 'invalid', 'invalid-type', now())`), /check constraint/);
  await db.exec(`INSERT INTO public.mc2_sms_jobs(token, job_key, message_type, due_at)
    VALUES ('eligible', 'original-live', 'session_live', now()), ('eligible', 'original-deadline', 'offer_deadline', now())`);
  for (const role of ['anon', 'authenticated']) {
    const privilege = (await db.query("SELECT has_function_privilege($1, 'public.queue_mc2_offer_followup_sms(timestamptz)', 'EXECUTE') AS allowed", [role])).rows[0];
    assert.equal(privilege.allowed, false);
  }
  assert.equal((await db.query("SELECT has_function_privilege('service_role', 'public.queue_mc2_offer_followup_sms(timestamptz)', 'EXECUTE') AS allowed")).rows[0].allowed, true);
  console.log('MC2 H+2 SQL: double migration, due-window, first actual view, buyer/test/consent exclusions, deduplication and permissions OK');
} finally {
  await db.close();
}
