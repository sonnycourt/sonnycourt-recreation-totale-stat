import assert from 'node:assert/strict';
import { addMc2BuyerToMailerLite } from '../netlify/functions/lib/mc2-mailerlite-buyers.mjs';

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || 'GET' });
  if (String(url).endsWith('/subscribers/buyer%40example.com')) {
    return new Response(JSON.stringify({ data: { id: 'subscriber-1' } }), { status: 200 });
  }
  if (String(url).endsWith('/subscribers/subscriber-1/groups/group-buyers')) {
    return new Response(null, { status: 204 });
  }
  return new Response('{}', { status: 404 });
};

try {
  const result = await addMc2BuyerToMailerLite({
    email: 'Buyer@Example.com',
    env: {
      MAILERLITE_API_KEY: 'test-key',
      MAILERLITE_GROUP_MC2_BUYERS: 'group-buyers',
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'POST');
  assert.equal((await addMc2BuyerToMailerLite({ email: 'buyer@example.com', env: {} })).skipped, 'api_key_missing');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({ mc2_buyer_group: 'ok', idempotent_assignment: 'ok' }, null, 2));
