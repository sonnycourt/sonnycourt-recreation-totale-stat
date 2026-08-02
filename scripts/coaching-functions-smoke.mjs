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
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'URL', 'DEPLOY_PRIME_URL',
  'MAILERSEND_API_KEY', 'COACHING_EMAIL_FROM', 'SPIFFY_COACHING_SESSION_1_IDS',
  'COACHING_SPIFFY_WEBHOOK_TOKEN'
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

process.env.COACHING_SPIFFY_WEBHOOK_TOKEN = 'private-coaching-webhook-token-test'
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase&token=private-coaching-webhook-token-test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).skipped, 'checkout')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase&token=wrong-token', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 401)
delete process.env.COACHING_SPIFFY_WEBHOOK_TOKEN

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

const purchasePayload = JSON.stringify({ type: 'card' })
const purchaseSignature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${purchasePayload}`).digest('base64')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${purchaseSignature}`
  },
  body: purchasePayload
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).skipped, 'checkout')

const failedPayload = JSON.stringify({ event: 'order.failed', order_id: 'failed-order', email: 'nobody@example.test' })
const failedSignature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${failedPayload}`).digest('base64')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${failedSignature}`
  },
  body: failedPayload
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

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
process.env.MAILERSEND_API_KEY = 'mailersend-test'
process.env.COACHING_EMAIL_FROM = 'coaching@example.test'
process.env.SPIFFY_COACHING_SESSION_1_IDS = 'followup-checkout-1'
process.env.URL = 'https://sonnycourt.com'
let recordedOrderPayload = null
let mailerSendCalls = 0
let orderRecordCalls = 0
let activationDeliveryAlreadySent = false
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.endsWith('/rest/v1/rpc/coaching_record_spiffy_order')) {
    orderRecordCalls += 1
    recordedOrderPayload = JSON.parse(options.body)
    return new Response(JSON.stringify([{
      order_id: '10000000-0000-4000-8000-000000000001',
      client_id: '10000000-0000-4000-8000-000000000002',
      engagement_id: '10000000-0000-4000-8000-000000000003',
      credits_added: orderRecordCalls === 1 ? 1 : 0,
      already_processed: orderRecordCalls > 1
    }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_clients?')) {
    return new Response(JSON.stringify([{ id: '10000000-0000-4000-8000-000000000002', email: 'camille@example.test', first_name: 'Camille', auth_user_id: null }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_email_deliveries?')) {
    return new Response(JSON.stringify(activationDeliveryAlreadySent ? [{ id: '10000000-0000-4000-8000-000000000005' }] : []), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_account_activations?') && options.method === 'PATCH') {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.endsWith('/rest/v1/coaching_account_activations') && options.method === 'POST') {
    return new Response(JSON.stringify([{ id: '10000000-0000-4000-8000-000000000004' }]), { status: 201, headers: { 'content-type': 'application/json' } })
  }
  if (target === 'https://api.mailersend.com/v1/email') {
    mailerSendCalls += 1
    return new Response('', { status: 202 })
  }
  if (target.endsWith('/rest/v1/coaching_email_deliveries') && options.method === 'POST') {
    return new Response(JSON.stringify([{ id: '10000000-0000-4000-8000-000000000005' }]), { status: 201, headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`Appel réseau inattendu: ${target}`)
}

const realPurchasePayload = JSON.stringify({
  order_id: 'spiffy-order-247',
  checkout_id: 'followup-checkout-1',
  order_total: '247.00',
  tax_total: '0.00',
  currency: 'EUR',
  email: 'camille@example.test',
  name_first: 'Camille',
  billing_country: 'FR',
  billing_street1: 'Donnée à ne pas stocker',
  phone_number: '+33000000000',
  last_four: '4242'
})
const realPurchaseSignature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${realPurchasePayload}`).digest('base64')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${realPurchaseSignature}`
  },
  body: realPurchasePayload
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).type, 'coaching_order')
assert.equal(recordedOrderPayload.p_amount_cents, 24700)
assert.equal(recordedOrderPayload.p_raw_payload.checkout_id, 'followup-checkout-1')
assert.ok(!JSON.stringify(recordedOrderPayload.p_raw_payload).includes('camille@example.test'))
assert.ok(!JSON.stringify(recordedOrderPayload.p_raw_payload).includes('4242'))
assert.equal(mailerSendCalls, 1)

activationDeliveryAlreadySent = true
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${realPurchaseSignature}`
  },
  body: realPurchasePayload
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).activation, 'already_sent')
assert.equal(mailerSendCalls, 1)

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MAILERSEND_API_KEY', 'COACHING_EMAIL_FROM', 'SPIFFY_COACHING_SESSION_1_IDS', 'URL']) delete process.env[key]
globalThis.fetch = async () => {
  throw new Error('Aucun appel réseau ne doit partir pendant ces tests')
}

process.env.COACHING_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(48).toString('base64url')
const encrypted = encryptCoachingSecret('refresh-token-test')
assert.notEqual(encrypted, 'refresh-token-test')
assert.equal(decryptCoachingSecret(encrypted), 'refresh-token-test')

console.log(JSON.stringify({
  fail_closed_endpoints: 8,
  preparation_gate: 'ok',
  webhook_signature: 'ok',
  webhook_private_token: 'ok',
  webhook_freshness: 'ok',
  explicit_spiffy_event: 'ok',
  unknown_checkouts_rejected: 'ok',
  failed_orders_rejected: 'ok',
  spiffy_purchase_contract: 'ok',
  activation_email_idempotency: 'ok',
  webhook_data_minimization: 'ok',
  token_encryption: 'ok',
  network_calls: 0
}))
