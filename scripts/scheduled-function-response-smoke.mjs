import assert from 'node:assert/strict';
import circleWorker from '../netlify/functions/mc2-circle-onboarding-scheduled.js';
import collectionWorker from '../netlify/functions/mc2-collection-cases-scheduled.js';
import contractWorker from '../netlify/functions/mc2-contract-document-emails-scheduled.js';
import dunningWorker from '../netlify/functions/mc2-dunning-scheduled.js';
import replayWorker from '../netlify/functions/mc2-replay-recovery-scheduled.js';
import sessionEmailWorker from '../netlify/functions/mc2-session-emails-scheduled.js';
import smsWorker from '../netlify/functions/mc2-sms-scheduled.js';
import payReminderWorker from '../netlify/functions/pay-reminders-scheduled.js';

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.MC2_CIRCLE_ENABLED = 'false';
process.env.MC2_COLLECTION_CASES_ENABLED = 'false';
process.env.MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED = 'false';
process.env.MC2_DUNNING_ENABLED = 'false';
process.env.MC2_REPLAY_RECOVERY_ENABLED = 'false';
process.env.MC2_SESSION_EMAILS_ENABLED = 'false';
process.env.MC2_OFFER_EMAILS_ENABLED = 'false';
process.env.MC2_SMS_ENABLED = 'false';

globalThis.fetch = async () => new Response(JSON.stringify([]), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const workers = [
  ['circle', circleWorker],
  ['collection', collectionWorker],
  ['contract_documents', contractWorker],
  ['dunning', dunningWorker],
  ['replay', replayWorker],
  ['session_emails', sessionEmailWorker],
  ['sms', smsWorker],
  ['pay_reminders', payReminderWorker],
];

for (const [name, worker] of workers) {
  const response = await worker();
  assert.ok(response instanceof Response, `${name} must return a Response`);
  assert.equal(response.status, 200, `${name} must return HTTP 200`);
  assert.match(response.headers.get('content-type') || '', /^application\/json\b/i);
  assert.equal(typeof (await response.json()).ok, 'boolean');
}

console.log(JSON.stringify({
  scheduled_function_response_contract: 'ok',
  handlers_checked: workers.length,
}, null, 2));
