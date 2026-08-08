const RUN_PREFIX = 'email-division:run:';
const LATEST_RUN_KEY = 'email-division:runs:latest';
const RUN_HISTORY_KEY = 'email-division:runs:history';
const RUN_LOCK_KEY = 'email-division:runs:lock:v2';
const WORKSPACE_KEY = 'email-division:workspace:broadcast-value';
const AUTONOMY_STATE_KEY = 'email-division:autonomy:state:v1';
const AUTONOMY_LATEST_PULSE_KEY = 'email-division:autonomy:pulses:latest';
const AUTONOMY_PULSE_HISTORY_KEY = 'email-division:autonomy:pulses:history';
const AUTONOMY_PULSE_PREFIX = 'email-division:autonomy:pulse:';
const AUTONOMY_LOCK_KEY = 'email-division:autonomy:lock:v1';
const TEST_PROOF_LOCK_PREFIX = 'email-division:test-proof:lock:';
const DIRECT_MISSION_PREFIX = 'email-division:direct-mission:';
const DIRECT_MISSION_HISTORY_KEY = 'email-division:direct-missions:history:v1';
const DIRECT_MISSION_LOCK_PREFIX = 'email-division:direct-mission:lock:';

function credentials() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) throw new Error('email_division_storage_not_configured');
  return { url, token };
}

export async function redis(command, ...args) {
  const { url, token } = credentials();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(`email_division_storage_failed:${payload.error || response.status}`);
  }
  return payload.result;
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export async function getRun(id) {
  if (!id) return null;
  return parseJson(await redis('GET', `${RUN_PREFIX}${id}`));
}

export async function getLatestRun() {
  const id = await redis('GET', LATEST_RUN_KEY);
  return id ? getRun(id) : null;
}

export async function saveRun(run) {
  const serialized = JSON.stringify(run);
  await redis('SET', `${RUN_PREFIX}${run.id}`, serialized, 'EX', 60 * 60 * 24 * 180);
  await redis('SET', LATEST_RUN_KEY, run.id);
  await redis('LREM', RUN_HISTORY_KEY, 0, run.id);
  await redis('LPUSH', RUN_HISTORY_KEY, run.id);
  await redis('LTRIM', RUN_HISTORY_KEY, 0, 49);
  return run;
}

export async function acquireRunLock(token, ttlSeconds = 240) {
  const result = await redis('SET', RUN_LOCK_KEY, token, 'NX', 'EX', ttlSeconds);
  return result === 'OK';
}

export async function releaseRunLock(token) {
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redis('EVAL', script, 1, RUN_LOCK_KEY, token);
}

export async function getBroadcastWorkspace() {
  return parseJson(await redis('GET', WORKSPACE_KEY));
}

export async function saveBroadcastWorkspace(workspace) {
  await redis('SET', WORKSPACE_KEY, JSON.stringify(workspace));
  return workspace;
}

export async function getAutonomyState() {
  return parseJson(await redis('GET', AUTONOMY_STATE_KEY));
}

export async function saveAutonomyState(state) {
  await redis('SET', AUTONOMY_STATE_KEY, JSON.stringify(state));
  return state;
}

export async function getAutonomyPulse(id) {
  if (!id) return null;
  return parseJson(await redis('GET', `${AUTONOMY_PULSE_PREFIX}${id}`));
}

export async function getLatestAutonomyPulse() {
  const id = await redis('GET', AUTONOMY_LATEST_PULSE_KEY);
  return id ? getAutonomyPulse(id) : null;
}

export async function getAutonomyPulseHistory(limit = 31) {
  const safeLimit = Math.max(1, Math.min(90, Math.round(Number(limit) || 31)));
  const ids = await redis('LRANGE', AUTONOMY_PULSE_HISTORY_KEY, 0, safeLimit - 1);
  if (!Array.isArray(ids) || !ids.length) return [];
  const rows = await redis('MGET', ...ids.map((id) => `${AUTONOMY_PULSE_PREFIX}${id}`));
  return (Array.isArray(rows) ? rows : []).map(parseJson).filter(Boolean);
}

export async function saveAutonomyPulse(pulse) {
  const serialized = JSON.stringify(pulse);
  await redis('SET', `${AUTONOMY_PULSE_PREFIX}${pulse.id}`, serialized, 'EX', 60 * 60 * 24 * 180);
  await redis('SET', AUTONOMY_LATEST_PULSE_KEY, pulse.id);
  await redis('LREM', AUTONOMY_PULSE_HISTORY_KEY, 0, pulse.id);
  await redis('LPUSH', AUTONOMY_PULSE_HISTORY_KEY, pulse.id);
  await redis('LTRIM', AUTONOMY_PULSE_HISTORY_KEY, 0, 89);
  return pulse;
}

export async function acquireAutonomyLock(token, ttlSeconds = 900) {
  const result = await redis('SET', AUTONOMY_LOCK_KEY, token, 'NX', 'EX', ttlSeconds);
  return result === 'OK';
}

export async function releaseAutonomyLock(token) {
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redis('EVAL', script, 1, AUTONOMY_LOCK_KEY, token);
}

export async function acquireTestProofLock(snapshotHash, ttlSeconds = 86_400) {
  const safeHash = String(snapshotHash || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
  if (safeHash.length !== 64) throw new Error('invalid_test_proof_snapshot_hash');
  const result = await redis('SET', `${TEST_PROOF_LOCK_PREFIX}${safeHash}`, '1', 'NX', 'EX', ttlSeconds);
  return result === 'OK';
}

export async function releaseTestProofLock(snapshotHash) {
  const safeHash = String(snapshotHash || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);
  if (safeHash.length === 64) await redis('DEL', `${TEST_PROOF_LOCK_PREFIX}${safeHash}`);
}

export async function getDirectMission(id) {
  if (!id) return null;
  return parseJson(await redis('GET', `${DIRECT_MISSION_PREFIX}${id}`));
}

export async function getDirectMissionHistory(limit = 40) {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 40)));
  const ids = await redis('LRANGE', DIRECT_MISSION_HISTORY_KEY, 0, safeLimit - 1);
  if (!Array.isArray(ids) || !ids.length) return [];
  const rows = await redis('MGET', ...ids.map((id) => `${DIRECT_MISSION_PREFIX}${id}`));
  return (Array.isArray(rows) ? rows : []).map(parseJson).filter(Boolean);
}

export async function saveDirectMission(mission) {
  if (!mission?.id) throw new Error('direct_mission_id_required');
  await redis('SET', `${DIRECT_MISSION_PREFIX}${mission.id}`, JSON.stringify(mission), 'EX', 60 * 60 * 24 * 180);
  await redis('LREM', DIRECT_MISSION_HISTORY_KEY, 0, mission.id);
  await redis('LPUSH', DIRECT_MISSION_HISTORY_KEY, mission.id);
  await redis('LTRIM', DIRECT_MISSION_HISTORY_KEY, 0, 99);
  return mission;
}

export async function acquireDirectMissionLock(id, token, ttlSeconds = 300) {
  const result = await redis('SET', `${DIRECT_MISSION_LOCK_PREFIX}${id}`, token, 'NX', 'EX', ttlSeconds);
  return result === 'OK';
}

export async function releaseDirectMissionLock(id, token) {
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  await redis('EVAL', script, 1, `${DIRECT_MISSION_LOCK_PREFIX}${id}`, token);
}
