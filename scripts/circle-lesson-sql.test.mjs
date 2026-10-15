import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration is repeatable, private, appendable and exposes honest timing', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    const sql = await readFile(new URL('../sql/circle_lesson_tracking.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const insert = `insert into public.circle_lesson_events
      (community_id,community_member_id,space_id,lesson_id,event_type,payload_sha256,payload,resolution_status,received_at)
      values (1,2,3,$1,'courses_lesson_completed',$2,'{}','identified',$3)`;
    await db.query(insert, [4, 'a'.repeat(64), '2026-10-15T10:00:00Z']);
    await db.query(insert, [5, 'b'.repeat(64), '2026-10-16T10:00:00Z']);
    const rows = (await db.query('select * from public.circle_lesson_timeline order by id')).rows;
    assert.equal(Number(rows[1].seconds_since_previous), 86400);
    assert.equal(rows[1].interval_basis, 'received');
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.circle_lesson_timeline'));
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from public.circle_lesson_events'));
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select count(*)::int n from public.circle_lesson_events')).rows[0].n, 2);
    await assert.rejects(db.query('delete from public.circle_lesson_events'));
  } finally { await db.close(); }
});
