import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL in memory only: no Supabase access, no real SMS.
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.mc2_registrations (
      token text PRIMARY KEY, telephone text, statut text, payment_status text,
      purchased_at timestamptz, session_starts_at timestamptz, slot_kind text,
      registration_completed_at timestamptz, entry_payment_required boolean,
      entry_payment_paid_at timestamptz
    );
    CREATE TABLE public.mc2_tracking_test_registrations (token text PRIMARY KEY);
  `);
  await db.exec(await readFile(new URL('../sql/mc2_sms.sql', import.meta.url), 'utf8'));
  const migration = await readFile(new URL('../sql/mc2_session_h1_sms.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  const now = '2026-10-30T10:00:00Z';
  const queue = async (at = now) => (await db.query('SELECT public.queue_mc2_session_h1_sms($1) AS n', [at])).rows[0].n;
  const add = async (token, start = '2026-10-30T11:00:00Z') => {
    await db.query(`INSERT INTO public.mc2_registrations
      (token, telephone, statut, sms_consent_at, session_starts_at, slot_kind, registration_completed_at)
      VALUES ($1, '+33612345678', 'registered', '2026-10-29T10:00:00Z', $2, 'scheduled', '2026-10-29T10:00:00Z')`, [token, start]);
    await db.query(`INSERT INTO public.mc2_sms_jobs(token, job_key, message_type, due_at)
      VALUES ($1, 'session_live:' || $1, 'session_live', $2)`, [token, start]);
  };
  await add('eligible');
  await add('nine-minutes-late', '2026-10-30T10:51:00Z');
  await add('too-early', '2026-10-30T11:01:00Z');
  await add('too-late', '2026-10-30T10:49:00Z');
  await add('test');
  await db.exec("INSERT INTO public.mc2_tracking_test_registrations VALUES ('test')");
  for (const [token, update] of Object.entries({
    jit: "slot_kind='jit'", rescheduled: "session_starts_at='2026-10-30T20:00:00Z'",
    incomplete: 'registration_completed_at=NULL', late: "registration_completed_at='2026-10-30T10:00:01Z'",
    consent: 'sms_consent_at=NULL', phone: "telephone=' '", entry: 'entry_payment_required=true',
    paid: "payment_status='paid'", purchased: "statut='purchased'", 'purchase-date': "purchased_at='2026-10-29T20:00:00Z'",
  })) {
    await add(token);
    await db.query(`UPDATE public.mc2_registrations SET ${update} WHERE token=$1`, [token]);
  }
  await add('cancelled-live');
  await db.exec("UPDATE public.mc2_sms_jobs SET status='skipped' WHERE token='cancelled-live'");
  const beforeRegistrations = JSON.stringify((await db.query('SELECT * FROM public.mc2_registrations ORDER BY token')).rows);
  const beforeLive = JSON.stringify((await db.query("SELECT * FROM public.mc2_sms_jobs WHERE message_type='session_live' ORDER BY id")).rows);
  assert.equal(await queue(), 2);
  assert.equal(await queue(), 0, 'no duplicate jobs');
  const jobs = (await db.query("SELECT token,due_at FROM public.mc2_sms_jobs WHERE message_type='session_h1' ORDER BY token")).rows;
  assert.deepEqual(jobs.map(r => r.token), ['eligible', 'nine-minutes-late']);
  assert.equal(new Date(jobs[0].due_at).toISOString(), now.replace('Z', '.000Z'));
  await db.exec("UPDATE public.mc2_sms_jobs SET status='sent' WHERE token='eligible' AND message_type='session_h1'");
  assert.equal(await queue(), 0, 'never requeue a sent reminder');
  assert.equal(JSON.stringify((await db.query('SELECT * FROM public.mc2_registrations ORDER BY token')).rows), beforeRegistrations);
  assert.equal(JSON.stringify((await db.query("SELECT * FROM public.mc2_sms_jobs WHERE message_type='session_live' ORDER BY id")).rows), beforeLive);

  // New evening session gets one new reminder, not a replay of the morning job.
  await db.exec(`UPDATE public.mc2_registrations SET session_starts_at='2026-10-30T20:00:00Z' WHERE token='eligible';
    INSERT INTO public.mc2_sms_jobs(token,job_key,message_type,due_at)
    VALUES ('eligible','session_live:eligible:evening','session_live','2026-10-30T20:00:00Z')`);
  assert.equal(await queue('2026-10-30T19:00:00Z'), 1);
  assert.equal(await queue('2026-10-30T19:00:00Z'), 0);
  // UTC arithmetic remains one hour across a DST transition.
  await add('dst', '2026-10-25T02:00:00Z');
  await db.exec("UPDATE public.mc2_registrations SET registration_completed_at='2026-10-24T10:00:00Z' WHERE token='dst'");
  assert.equal(await queue('2026-10-25T01:00:00Z'), 1);
  // Preserve all pre-existing message types.
  await db.exec(`INSERT INTO public.mc2_sms_jobs(token,job_key,message_type,due_at)
    VALUES ('eligible','old-deadline','offer_deadline',now()), ('eligible','other-followup','offer_followup',now())`);
  await db.exec(migration);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'public.queue_mc2_session_h1_sms(timestamptz)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await db.query("SELECT has_function_privilege('service_role','public.queue_mc2_session_h1_sms(timestamptz)','EXECUTE') AS allowed")).rows[0].allowed, true);
  console.log('Session H-1 SQL: repeatable migration, due window, JIT/late/consent/buyer/test exclusions, idempotency, reschedule, DST, existing live jobs preserved and RPC permissions OK');
} finally { await db.close(); }
