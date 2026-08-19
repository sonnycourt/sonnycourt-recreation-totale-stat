import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const calls = [];

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
  const pathname = new URL(String(url)).pathname;
  if (pathname === '/api/subscribers/new%40example.com') {
    return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
  }
  if (pathname === '/api/subscribers/existing%40example.com') {
    return Response.json({ data: { id: 'subscriber-existing' } });
  }
  if (pathname === '/api/subscribers' && options.method === 'POST') {
    return Response.json({ data: { id: 'subscriber-new' } });
  }
  if (pathname === '/api/subscribers/subscriber-existing' && options.method === 'PUT') {
    return Response.json({ data: { id: 'subscriber-existing' } });
  }
  if (pathname.includes('/groups/group-waitlist') && options.method === 'POST') {
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify({ error: pathname }), { status: 500 });
};

process.env.MAILERLITE_API_KEY = 'test-key';
process.env.MAILERLITE_GROUP_MC2_WAITLIST = 'group-waitlist';
const { default: handler } = await import('../netlify/functions/masterclass-waitlist.js');

const request = (body) => new Request('https://sonnycourt.com/.netlify/functions/masterclass-waitlist', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

let response = await handler(request({ prenom: 'Léa', email: 'new@example.com' }));
assert.equal(response.status, 200);
assert.equal((await response.json()).success, true);
assert(calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/subscribers')));
assert(calls.some((call) => call.url.endsWith('/subscribers/subscriber-new/groups/group-waitlist')));

response = await handler(request({ prenom: 'Marc', email: 'existing@example.com' }));
assert.equal(response.status, 200);
assert(calls.some((call) => call.method === 'PUT' && call.url.endsWith('/api/subscribers/subscriber-existing')));
assert(calls.some((call) => call.url.endsWith('/subscribers/subscriber-existing/groups/group-waitlist')));

const beforeTrap = calls.length;
response = await handler(request({ prenom: 'Bot', email: 'bot@example.com', company: 'Spam Ltd' }));
assert.equal(response.status, 200);
assert.equal(calls.length, beforeTrap);

response = await handler(request({ prenom: '', email: 'invalide' }));
assert.equal(response.status, 400);

delete process.env.MAILERLITE_GROUP_MC2_WAITLIST;
response = await handler(request({ prenom: 'Léa', email: 'new@example.com' }));
assert.equal(response.status, 503);

globalThis.fetch = originalFetch;
console.log('Masterclass waitlist smoke: OK');
