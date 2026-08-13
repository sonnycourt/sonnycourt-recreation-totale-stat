import assert from 'node:assert/strict';
import {
  mc2ContractDocumentEmailsEnabled,
  processMc2ContractDocumentEmail,
} from '../netlify/functions/lib/mc2-contract-document-email.mjs';

assert.equal(mc2ContractDocumentEmailsEnabled({ MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED: 'false' }), false);
assert.equal(mc2ContractDocumentEmailsEnabled({ MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED: 'true' }), true);

const env = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  MAILERLITE_API_KEY: 'ml-test',
  MAILERLITE_GROUP_MC2_CONTRACT_DOCUMENTS: 'group-contract',
  MC2_PUBLIC_BASE_URL: 'https://sonnycourt.com',
};
Object.assign(process.env, env);
const document = {
  id: 42,
  registration_token: 'registration-secret',
  access_token: 'A'.repeat(43),
  purchased_at: '2026-08-13T18:30:00.000Z',
  notification_status: 'pending',
  notification_due_at: '2026-08-13T18:30:00.000Z',
  notification_attempts: 0,
};
const calls = [];
let claimed = false;
let registrationPaid = true;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  const method = options.method || 'GET';
  calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
  if (url.startsWith('https://supabase.test/rest/v1/mc2_contract_documents?') && method === 'PATCH') {
    const body = JSON.parse(options.body || '{}');
    if (body.notification_status === 'processing') {
      if (claimed) return new Response('[]', { status: 200 });
      claimed = true;
    }
    return new Response(JSON.stringify([{ ...document, ...body }]), { status: 200 });
  }
  if (url.startsWith('https://supabase.test/rest/v1/mc2_registrations?') && method === 'GET') {
    return new Response(JSON.stringify(registrationPaid ? [{
      token: document.registration_token,
      email: 'client@example.com',
      prenom: 'Camille',
      payment_status: 'paid',
    }] : []), { status: 200 });
  }
  if (url.includes('/api/subscribers/client%40example.com') && method === 'GET') {
    return new Response(JSON.stringify({ data: { id: 'subscriber-1', status: 'active' } }), { status: 200 });
  }
  if (url.endsWith('/api/subscribers/subscriber-1') && method === 'PUT') {
    return new Response(JSON.stringify({ data: { id: 'subscriber-1' } }), { status: 200 });
  }
  if (url.endsWith('/api/subscribers/subscriber-1/groups/group-contract') && method === 'DELETE') {
    return new Response(null, { status: 204 });
  }
  if (url.endsWith('/api/subscribers/subscriber-1/groups/group-contract') && method === 'POST') {
    return new Response(null, { status: 204 });
  }
  throw new Error(`unexpected_fetch:${method}:${url}`);
};

const now = new Date('2026-08-13T18:31:00.000Z');
const delivered = await processMc2ContractDocumentEmail(document, now, env);
assert.equal(delivered.status, 'delivered', JSON.stringify({ delivered, calls }, null, 2));
const fieldCall = calls.find((call) => call.method === 'PUT' && call.url.endsWith('/api/subscribers/subscriber-1'));
assert.equal(fieldCall.body.fields.first_name, 'Camille');
assert.equal(
  fieldCall.body.fields.mc2_contract_documents_url,
  `https://sonnycourt.com/documents-contractuels/${document.access_token}`,
);
assert.equal(fieldCall.body.fields.mc2_contract_purchase_date, '13/08/2026');
assert.equal(fieldCall.body.fields.mc2_contract_documents_url.includes('stripe'), false);
assert.equal(calls.filter((call) => call.method === 'POST' && call.url.includes('/groups/')).length, 1);

const duplicate = await processMc2ContractDocumentEmail(document, now, env);
assert.deepEqual(duplicate, { status: 'skipped', reason: 'already_claimed' });

claimed = false;
registrationPaid = false;
const unpaid = await processMc2ContractDocumentEmail({ ...document, id: 43 }, now, env);
assert.equal(unpaid.status, 'retry');
assert.equal(unpaid.error, 'paid_registration_missing');

console.log('MC2 contract document email smoke: OK');
