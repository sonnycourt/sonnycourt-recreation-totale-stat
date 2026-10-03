import assert from 'node:assert/strict';
import check from '../netlify/functions/check-mc2-eligibility.js';
import register from '../netlify/functions/register-mc2.js';
import presence from '../netlify/functions/mc2-presence.js';
import track from '../netlify/functions/track-mc2-event.js';
import journey from '../netlify/functions/track-mc2-journey.js';
import { sameMc2Generation } from '../netlify/functions/lib/mc2-session-generation.mjs';
process.env.SUPABASE_URL = 'https://db.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-only';
process.env.MC2_REREGISTRATION_ENABLED = 'true';
delete process.env.MAILERLITE_API_KEY;
delete process.env.META_ACCESS_TOKEN;
process.env.MC2_SESSION_EMAILS_ENABLED = 'false';
const old = { id: 1, token: 'unit-token-123456789', email: 'unit@example.invalid', prenom: 'Unit',
  statut: 'registered', session_generation: 0, registration_completed_at: '2026-01-01T00:00:00Z',
  session_starts_at: '2026-01-01T12:00:00Z', session_ends_at: '2026-01-01T14:00:00Z' };
let row = { ...old }, cta = false, writes = [], failRpc = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  assert.ok(String(url).startsWith('https://db.invalid/rest/v1/'), 'No external side effect');
  const path = new URL(url).pathname;
  if (init.method && init.method !== 'GET') {
    writes.push({ path, body: JSON.parse(init.body) });
    if (path.endsWith('/rpc/mc2_reregister_session')) {
      if (failRpc) return Response.json({ error: 'notification_in_flight' }, { status: 409 });
      if (JSON.parse(init.body).p_expected_generation !== row.session_generation)
        return Response.json({error:'session_changed'}, {status:409});
      row = { ...row, ...JSON.parse(init.body).p_session, session_generation: 1 };
      return Response.json(row);
    }
    if (path.endsWith('/rpc/mc2_tracking_ingest_v2')) return Response.json({accepted:JSON.parse(init.body).items.map(e=>e.event_id)});
    return Response.json([row]);
  }
  if (path.endsWith('/mc2_registrations')) return Response.json([row]);
  if (path.endsWith('/mc2_tracking_events_v2')) return Response.json(cta ? [{ event_name: 'cta_playback_present' }] : []);
  return Response.json([]);
};
const request = body => new Request('https://site.invalid/function', { method: 'POST', body: JSON.stringify(body) });
const start = new Date(Math.ceil((Date.now()+60000)/900000)*900000).toISOString();
const body = { email: old.email, prenom:'Unit', telephone:'+33612345678',pays:'France',
  session_starts_at:start,slot_kind:'jit',visitor_timezone:'Europe/Paris' };
try {
  assert.equal((await (await check(request({ email: old.email }))).json()).eligible,true);
  cta=true;
  assert.equal((await (await check(request({ email: old.email }))).json()).eligible,false);
  assert.equal((await register(request(body))).status,403);
  assert.equal(writes.length,0);
  cta=false; failRpc=true;
  assert.equal((await register(request(body))).status,409);
  assert.equal(writes.filter(w => !w.path.endsWith('/rpc/mc2_reregister_session')).length,0);
  failRpc=false; writes=[];
  const response=await register(request(body));
  assert.equal(response.status,200);
  assert.equal((await response.json()).sessionGeneration,1);
  assert.equal(writes.filter(w => w.path.endsWith('/rpc/mc2_reregister_session')).length,1);
  writes=[];
  assert.equal((await register(request(body))).status,409);
  assert.equal(writes.length,0,'Duplicate request cannot queue new reminders');
  assert.equal((await presence(request({ token:row.token, session_generation:0 }))).status,409);
  assert.equal((await track(request({ token:row.token,event:'session_joined',session_generation:0 }))).status,409);
  assert.equal(writes.length,0,'Stale tab cannot write');
  assert.equal(sameMc2Generation(row,undefined),false);
  assert.equal(sameMc2Generation(row,1),true);
  assert.equal(sameMc2Generation(old,undefined),true,'Old clients remain compatible before reenrollment');
  const observation = {event_id:'ac8d6388-b119-4a3f-ab2f-f1d5b5beb900',visit_id:'bc8d6388-b119-4a3f-ab2f-f1d5b5beb901',
    token:row.token,event_name:'cta_playback_present',route:'/mc2/session/',client_occurred_at:new Date().toISOString(),metadata:{session_generation:0}};
  const stale = await (await journey(request({schema_version:2,events:[observation]}))).json();
  assert.deepEqual(stale.rejected,[observation.event_id]);
  assert.equal(writes.length,0);
  const fresh = await (await journey(request({schema_version:2,events:[{...observation,metadata:{session_generation:1}}]}))).json();
  assert.deepEqual(fresh.accepted,[observation.event_id]);
  row={...old}; writes=[];
  const parallel = await Promise.all([register(request(body)),register(request(body))]);
  assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409],'One transition when two requests overlap');
  row={...old}; delete process.env.MC2_REREGISTRATION_ENABLED;
  assert.equal((await (await check(request({email:row.email}))).json()).eligible,false,'Default feature is disabled');
  console.log('Endpoints OK : CTA, panne transaction, réinscription, POST répété, ancien onglet, aucun appel externe, flag désactivé par défaut.');
} finally { globalThis.fetch=originalFetch; }
