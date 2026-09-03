import assert from 'node:assert/strict';
import runWorker from '../netlify/functions/mc2-session-emails-scheduled.js';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';

const queries = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  queries.push({ url: url.toString(), method: options.method || 'GET' });
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

process.env.MC2_SESSION_EMAILS_ENABLED = 'false';
process.env.MC2_OFFER_EMAILS_ENABLED = 'true';
let result = JSON.parse((await runWorker()).body);
assert.equal(result.sessionEmailsEnabled, false);
assert.equal(result.offerEmailsEnabled, true);
let dueQuery = queries.find((item) => item.method === 'GET')?.url || '';
assert.match(dueQuery, /offer_followup_90m/);
assert.doesNotMatch(dueQuery, /registration_confirmation/);

queries.length = 0;
process.env.MC2_SESSION_EMAILS_ENABLED = 'true';
process.env.MC2_OFFER_EMAILS_ENABLED = 'false';
result = JSON.parse((await runWorker()).body);
assert.equal(result.sessionEmailsEnabled, true);
assert.equal(result.offerEmailsEnabled, false);
dueQuery = queries.find((item) => item.method === 'GET')?.url || '';
assert.match(dueQuery, /registration_confirmation/);
assert.doesNotMatch(dueQuery, /offer_followup_90m/);

queries.length = 0;
process.env.MC2_SESSION_EMAILS_ENABLED = 'false';
process.env.MC2_OFFER_EMAILS_ENABLED = 'false';
result = JSON.parse((await runWorker()).body);
assert.equal(result.enabled, false);
assert.equal(queries.length, 0);

console.log(JSON.stringify({
  independent_session_and_offer_flags: 'ok',
  disabled_worker_has_no_side_effect: 'ok',
}, null, 2));
