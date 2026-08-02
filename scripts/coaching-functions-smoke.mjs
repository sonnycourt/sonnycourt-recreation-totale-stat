import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import activateAccount from '../netlify/functions/coaching-activate-account.js'
import bookSession from '../netlify/functions/coaching-book-session.js'
import cancelSession from '../netlify/functions/coaching-cancel-session.js'
import coachDiagnostic from '../netlify/functions/coach-diagnostic.js'
import googleCallback from '../netlify/functions/coaching-google-callback.js'
import googleConnect from '../netlify/functions/coaching-google-connect.js'
import spiffyWebhook from '../netlify/functions/coach-spiffy-webhook.js'
import syncAvailability from '../netlify/functions/coaching-sync-availability.js'
import { decryptCoachingSecret, encryptCoachingSecret } from '../netlify/functions/lib/coaching-google.mjs'

const managedEnv = [
  'COACHING_TOKEN_ENCRYPTION_KEY', 'GOOGLE_COACHING_CLIENT_ID',
  'GOOGLE_COACHING_CLIENT_SECRET', 'SPIFFY_SIGNING_SECRET', 'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'URL', 'DEPLOY_PRIME_URL'
]
for (const key of managedEnv) delete process.env[key]

globalThis.fetch = async () => {
  throw new Error('Aucun appel réseau ne doit partir pendant ces tests')
}

const request = (url, options = {}) => new Request(url, options)
const body = async (response) => response.json()

let response = await activateAccount(request('http://localhost/.netlify/functions/coaching-activate-account', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 400)

response = await bookSession(request('http://localhost/.netlify/functions/coaching-book-session', { method: 'POST' }))
assert.equal(response.status, 503)

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key'
globalThis.fetch = async () => new Response(JSON.stringify({ message: 'preparation_required' }), {
  status: 400, headers: { 'content-type': 'application/json' }
})
response = await bookSession(request('http://localhost/.netlify/functions/coaching-book-session', {
  method: 'POST',
  headers: { authorization: 'Bearer user-access-token', 'content-type': 'application/json' },
  body: JSON.stringify({ slot_id: '00000000-0000-4000-8000-000000000099' })
}))
assert.equal(response.status, 409)
assert.ok((await body(response)).error.includes('préparation'))
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_PUBLISHABLE_KEY
globalThis.fetch = async () => {
  throw new Error('Aucun appel réseau ne doit partir pendant ces tests')
}

response = await cancelSession(request('http://localhost/.netlify/functions/coaching-cancel-session', { method: 'POST' }))
assert.equal(response.status, 401)

response = await googleConnect(request('http://localhost/.netlify/functions/coaching-google-connect', { method: 'POST' }))
assert.equal(response.status, 503)

response = await googleCallback(request('http://localhost/.netlify/functions/coaching-google-callback'))
assert.equal(response.status, 302)
assert.ok(response.headers.get('location').includes('google=error'))

response = await syncAvailability(request('http://localhost/.netlify/functions/coaching-sync-availability', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 401)

response = await coachDiagnostic(request('http://localhost/.netlify/functions/coach-diagnostic', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 400)

response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 503)

const signatureSecretBytes = crypto.randomBytes(32)
process.env.SPIFFY_SIGNING_SECRET = `whsec_${signatureSecretBytes.toString('base64')}`
const webhookId = 'msg_test_coaching'
const timestamp = String(Math.floor(Date.now() / 1000))
const payload = JSON.stringify({ event: 'ping' })
const signature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${payload}`).digest('base64')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`
  },
  body: payload
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).skipped, 'event')

response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': String(Number(timestamp) - 601),
    'webhook-signature': `v1,${signature}`
  },
  body: payload
}))
assert.equal(response.status, 401)

process.env.COACHING_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(48).toString('base64url')
const encrypted = encryptCoachingSecret('refresh-token-test')
assert.notEqual(encrypted, 'refresh-token-test')
assert.equal(decryptCoachingSecret(encrypted), 'refresh-token-test')

console.log(JSON.stringify({
  fail_closed_endpoints: 8,
  preparation_gate: 'ok',
  webhook_signature: 'ok',
  webhook_freshness: 'ok',
  token_encryption: 'ok',
  network_calls: 0
}))
