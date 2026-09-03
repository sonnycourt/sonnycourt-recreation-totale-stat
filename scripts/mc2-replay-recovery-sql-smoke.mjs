import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../sql/mc2_replay_recovery_message_type_hotfix.sql', import.meta.url),
  'utf8',
);
const health = await readFile(
  new URL('../netlify/functions/mc2-health.js', import.meta.url),
  'utf8',
);

assert.match(migration, /begin;/i);
assert.match(migration, /add column if not exists message_type text/i);
assert.match(migration, /where message_type is null/i);
assert.match(migration, /alter column message_type set not null/i);
assert.match(migration, /mc2_replay_recovery_jobs_message_type_check/i);
assert.match(migration, /commit;/i);
assert.match(
  health,
  /mc2_replay_recovery_jobs\?select=message_type,/,
  'Le healthcheck doit vérifier la présence réelle de message_type en production.',
);

console.log(JSON.stringify({
  mc2_replay_message_type_hotfix: 'ok',
  healthcheck_schema_guard: 'ok',
}, null, 2));
