import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import handler from '../netlify/functions/mc2-survey.js';
import { createSurveySync } from '../src/lib/mc2-survey-client.mjs';
import { mc2SurveyOpen } from '../src/lib/mc2-survey.mjs';

// All HTTP is mocked; all SQL runs in disposable local PostgreSQL only.
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create table mc2_registrations(id bigint primary key); insert into mc2_registrations values (1);`);
const sql = readFileSync(new URL('../sql/mc2_survey_responses.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql);
const originalFetch = globalThis.fetch;
const previousEnv = Object.fromEntries(['CONTEXT','NETLIFY_DEV','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].map(k => [k,process.env[k]]));
Object.assign(process.env, { CONTEXT: 'production', NETLIFY_DEV: 'false', SUPABASE_URL: 'https://survey.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' });
const token = 'fixture-registration-1234';
let row = { id: 1, session_generation: 0, session_starts_at: new Date(Date.now() + 60000).toISOString(), registration_completed_at: new Date().toISOString() };
let test = false, fail = false, writes = 0;
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  assert.equal(u.hostname, 'survey.invalid', 'No external calls');
  if (fail) return Response.json({}, { status: 503 });
  if (u.pathname.endsWith('/mc2_registrations')) return Response.json(row ? [row] : []);
  if (u.pathname.endsWith('/mc2_tracking_test_registrations')) return Response.json(test ? [{ token }] : []);
  assert.ok(u.pathname.endsWith('/mc2_survey_responses'));
  if (options.method === 'POST') {
    writes++;
    assert.equal(options.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
    const value = JSON.parse(options.body), keys = Object.keys(value);
    // Model PostgREST partial upsert: conflict updates only supplied columns.
    const updates = keys.filter(k => !['registration_id','session_generation','survey_version'].includes(k));
    await db.query(`insert into mc2_survey_responses (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})
      on conflict (registration_id,session_generation,survey_version) do update set ${updates.map(k=>`${k}=excluded.${k}`).join(',')}`, Object.values(value));
    return new Response(null, { status: 201 });
  }
  const result = await db.query('select * from mc2_survey_responses where registration_id=$1 and session_generation=$2',
    [u.searchParams.get('registration_id').slice(3), u.searchParams.get('session_generation').slice(3)]);
  return Response.json(result.rows);
};
const call = (extra = {}, origin = 'https://sonnycourt.com') => handler(new Request('https://sonnycourt.com/.netlify/functions/mc2-survey', {
  method: 'POST', headers: { 'Content-Type': 'application/json', origin },
  body: JSON.stringify({ token, sessionGeneration: 0, surveyVersion: 1, action: 'load', ...extra }),
}));
try {
  assert.deepEqual(await (await call()).json(), { answers: {}, completed: false });
  assert.equal((await call({ action:'save', answers:{ priority:'finances_work' }, registration_id:999 })).status,200);
  assert.equal((await call({ action:'save', answers:{ familiarity:'new' } })).status,200);
  let data = await (await call()).json();
  assert.deepEqual(data.answers, { priority:'finances_work', familiarity:'new' });
  assert.equal(data.completed,false);
  await call({ action:'save', answers:{ profession:'employee', urgency:'urgent' } });
  assert.equal((await (await call()).json()).completed,true);
  const before = writes;
  for (const answers of [{ urgency:'invalid' }, { email:'x' }, {}, null, ['urgent'], { urgency:null }])
    assert.equal((await call({ action:'save', answers })).status,400);
  assert.equal((await call({ sessionGeneration:9 })).status,409);
  assert.equal((await call({},'https://other.invalid')).status,403);
  test = true; assert.equal((await call()).status,403); test = false;
  row.entry_payment_required = true; assert.equal((await call()).status,403); row.entry_payment_required = false;
  const completed = row.registration_completed_at; row.registration_completed_at = null;
  assert.equal((await call()).status,403); row.registration_completed_at = completed;
  process.env.CONTEXT = 'deploy-preview'; assert.equal((await call()).status,403); process.env.CONTEXT='production';
  fail = true; assert.equal((await call()).status,503); fail=false;
  const start = row.session_starts_at;
  row.session_starts_at = new Date(Date.now()-301000).toISOString();
  assert.equal((await call({ action:'save', answers:{ urgency:'exploring' } })).status,410);
  row.session_starts_at=start;
  assert.equal(writes,before,'Rejected requests never write');
  row.session_generation=1;
  await call({ action:'save', sessionGeneration:1, answers:{ priority:'relationships' } });
  assert.equal((await db.query('select count(*)::int n from mc2_survey_responses')).rows[0].n,2);
  await db.exec(sql);
  assert.equal((await db.query('select count(*)::int n from mc2_survey_responses')).rows[0].n,2);
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from mc2_survey_responses'));
    await db.exec('reset role');
  }
} finally {
  globalThis.fetch=originalFetch;
  for (const [k,v] of Object.entries(previousEnv)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; }
  await db.close();
}

// Client serialization, restoration, retry, preview isolation.
const tick = () => new Promise(resolve=>setTimeout(resolve,0));
let calls=[], loaded, release, statuses=[], failures=0;
const timers=[];
const client = createSurveySync({ token, sessionGeneration:0, preview:false,
  onLoad:(answers)=>{loaded=answers;}, onStatus:(...v)=>statuses.push(v),
  schedule:(fn,ms)=>{const task={fn,ms};timers.push(task);return task;}, cancel:task=>{if(task)task.cancelled=true;},
  fetcher:async (_url, options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    if(body.action==='load') return Response.json({ answers:{ priority:'relationships' }, completed:false });
    if(failures-->0) throw new Error('offline');
    await new Promise(resolve=>{release=resolve;});
    return Response.json({saved:true});
  },
});
await tick();assert.equal(loaded.priority,'relationships');
client.save('urgency','exploring');await tick();
client.save('urgency','urgent');client.save('profession','student');
release();await tick();
assert.deepEqual(calls.at(-1).answers,{urgency:'urgent',profession:'student'});
release();await tick();assert.deepEqual(statuses.at(-1),['',false]);
failures=1;client.save('familiarity','follower');await tick();
const retry=timers.find(t=>t.ms===2000&&!t.cancelled);assert.ok(retry);retry.fn();await tick();
assert.deepEqual(calls.at(-1).answers,{familiarity:'follower'});release();await tick();client.dispose();
const preview=createSurveySync({token:'',sessionGeneration:0,preview:true,onLoad:()=>{},onStatus:()=>{},fetcher:()=>{throw new Error('Preview sent data');}});
preview.save('urgency','urgent');preview.dispose();
const start=Date.parse('2026-11-08T17:00:00Z');
assert.equal(mc2SurveyOpen(new Date(start).toISOString(),start+299999),true);
assert.equal(mc2SurveyOpen(new Date(start).toISOString(),start+300000),false);
assert.equal(mc2SurveyOpen('invalid'),false);
console.log('PASS MC2 survey: private SQL, repeat migration, partial upsert, restore, generation isolation, validation, deadline, preview/test exclusion, serial saves and retry. No external writes.');
