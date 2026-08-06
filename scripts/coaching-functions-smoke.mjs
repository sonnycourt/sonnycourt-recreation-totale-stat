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
import syncScheduled from '../netlify/functions/coaching-sync-scheduled.js'
import reviewReminders from '../netlify/functions/coaching-review-reminders.js'
import resendActivation from '../netlify/functions/coaching-resend-activation.js'
import stripeCheckout from '../netlify/functions/coaching-stripe-checkout.js'
import stripePortal from '../netlify/functions/coaching-stripe-portal.js'
import stripeWebhook from '../netlify/functions/coaching-stripe-webhook.js'
import { decryptCoachingSecret, encryptCoachingSecret } from '../netlify/functions/lib/coaching-google.mjs'
import { finalizeCoachingBooking } from '../netlify/functions/lib/coaching-integrations.mjs'
import { coachingAppOrigin, coachingAppUrl, coachingMarketingOrigin, coachingMarketingUrl } from '../netlify/functions/lib/coaching-origin.mjs'

const managedEnv = [
  'COACHING_TOKEN_ENCRYPTION_KEY', 'GOOGLE_COACHING_CLIENT_ID',
  'GOOGLE_COACHING_CLIENT_SECRET', 'SPIFFY_SIGNING_SECRET', 'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL',
  'PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'URL', 'DEPLOY_PRIME_URL',
  'MAILERSEND_API_KEY', 'COACHING_EMAIL_FROM', 'SPIFFY_COACHING_SESSION_1_IDS',
  'SPIFFY_ES2_COMPLETE_IDS',
  'COACHING_SPIFFY_WEBHOOK_TOKEN', 'GOOGLE_ROMAIN_REFRESH_TOKEN',
  'COACHING_APP_ORIGIN',
  'COACHING_MARKETING_ORIGIN', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_COACHING_WEBHOOK_SECRET',
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

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
let authAdminCalls = 0
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.includes('/rest/v1/coaching_account_activations?') && (!options.method || options.method === 'GET')) {
    return new Response(JSON.stringify([{
      id: '00000000-0000-4000-8000-000000000010',
      client_id: '00000000-0000-4000-8000-000000000011',
      coaching_clients: { id: '00000000-0000-4000-8000-000000000011', auth_user_id: '00000000-0000-4000-8000-000000000012', email: 'coach@example.test', first_name: 'Coach', last_name: 'Interne' }
    }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_account_activations?') && options.method === 'PATCH') {
    return new Response(JSON.stringify([{ id: '00000000-0000-4000-8000-000000000010' }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_memberships?')) {
    return new Response(JSON.stringify([{ role: 'coach' }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/auth/v1/admin/users')) authAdminCalls += 1
  throw new Error(`Appel inattendu pendant le test de rôle: ${target}`)
}
response = await activateAccount(request('http://localhost/.netlify/functions/coaching-activate-account', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(48), password: 'mot-de-passe-solide' })
}))
assert.equal(response.status, 409)
assert.equal(authAdminCalls, 0)
delete process.env.SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY
globalThis.fetch = async () => {
  throw new Error('Aucun appel réseau ne doit partir pendant ces tests')
}

response = await bookSession(request('http://localhost/.netlify/functions/coaching-book-session', { method: 'POST' }))
assert.equal(response.status, 503)

process.env.COACHING_SPIFFY_WEBHOOK_TOKEN = 'private-coaching-webhook-token-test'
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase&token=private-coaching-webhook-token-test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).skipped, 'checkout')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase&token=private-coaching-webhook-token-test', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ checkout_slug: 'esprit-subconscient-2-0-39' })
}))
assert.equal(response.status, 200)
assert.equal((await body(response)).skipped, 'coaching_identity')
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
  body: JSON.stringify({ slot_id: '00000000-0000-4000-8000-000000000099', duration_minutes: 45 })
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
assert.equal(response.headers.get('location'), 'https://coaching.sonnycourt.com/coach?google=error#settings')
assert.equal(coachingAppOrigin({}), 'https://coaching.sonnycourt.com')
assert.equal(coachingAppUrl('/eleve', { COACHING_APP_ORIGIN: 'http://localhost:4321' }), 'http://localhost:4321/eleve')
assert.equal(coachingMarketingOrigin({}), 'https://sonnycourt.com')
assert.equal(coachingMarketingUrl('/coach-romain/confirmation', { COACHING_MARKETING_ORIGIN: 'http://localhost:4321' }), 'http://localhost:4321/coach-romain/confirmation')

response = await syncAvailability(request('http://localhost/.netlify/functions/coaching-sync-availability', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
}))
assert.equal(response.status, 401)
response = await syncScheduled()
assert.equal(response.status, 503)

response = await reviewReminders()
assert.equal(response.status, 500)

response = await resendActivation(request('http://localhost/.netlify/functions/coaching-resend-activation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'invalide' })
}))
assert.equal(response.status, 400)
const resendConsoleError = console.error
console.error = () => {}
response = await resendActivation(request('http://localhost/.netlify/functions/coaching-resend-activation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'client@example.test' })
}))
console.error = resendConsoleError
assert.equal(response.status, 200)

response = await stripeCheckout(request('http://localhost/.netlify/functions/coaching-stripe-checkout', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer_slug: 'session-1' })
}))
assert.equal(response.status, 503)

response = await stripePortal(request('http://localhost/.netlify/functions/coaching-stripe-portal', { method: 'POST' }))
assert.equal(response.status, 401)

response = await stripeWebhook(request('http://localhost/.netlify/functions/coaching-stripe-webhook', { method: 'POST', body: '{}' }))
assert.equal(response.status, 503)

process.env.STRIPE_SECRET_KEY = 'sk_test_51TestOnlyKeyForLocalSmokeTest'
process.env.STRIPE_COACHING_WEBHOOK_SECRET = 'whsec_local_smoke_test'
const stripeConsoleError = console.error
console.error = () => {}
response = await stripeWebhook(request('http://localhost/.netlify/functions/coaching-stripe-webhook', {
  method: 'POST', headers: { 'stripe-signature': 't=1,v1=invalid' }, body: '{}'
}))
console.error = stripeConsoleError
assert.equal(response.status, 400)
delete process.env.STRIPE_SECRET_KEY
delete process.env.STRIPE_COACHING_WEBHOOK_SECRET

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
process.env.SPIFFY_FIRST_CONSULTATION_IDS = '39602'
process.env.URL = 'https://sonnycourt.com'
const firstConsultationSessionId = '10000000-0000-4000-8000-000000000010'
let recordedOrderPayload = null
let mailerSendCalls = 0
let lastMailerPayload = null
let orderRecordCalls = 0
let refundRpcCalls = 0
let firstConsultationImportCalls = 0
let activationDeliveryAlreadySent = false
let diagnosticBookingStatus = 'pending_payment'
let diagnosticBookingExpiresAt = new Date(Date.now() + 600000).toISOString()
let diagnosticSlotStatus = 'held'
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
  if (target.includes('/rest/v1/coaching_orders?')) {
    return new Response(JSON.stringify([{ id: '10000000-0000-4000-8000-000000000001', engagement_id: '10000000-0000-4000-8000-000000000006' }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.endsWith('/rest/v1/rpc/coaching_refund_spiffy_order')) {
    refundRpcCalls += 1
    return new Response(JSON.stringify([{ order_id: '10000000-0000-4000-8000-000000000001', client_id: '10000000-0000-4000-8000-000000000002', credits_removed: 1, already_processed: false }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.endsWith('/rest/v1/rpc/coaching_import_first_consultation')) {
    firstConsultationImportCalls += 1
    return new Response(JSON.stringify(firstConsultationSessionId), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coach_diagnostic_bookings?') && options.method === 'PATCH') {
    const payload = JSON.parse(options.body)
    diagnosticBookingStatus = payload.status
    return new Response(JSON.stringify([{ id: '10000000-0000-4000-8000-000000000008' }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coach_diagnostic_bookings?')) {
    return new Response(JSON.stringify([{
      id: '10000000-0000-4000-8000-000000000008',
      slot_id: 42,
      status: diagnosticBookingStatus,
      expires_at: diagnosticBookingExpiresAt
    }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coach_diagnostic_slots?') && options.method === 'PATCH') {
    if (!['held', 'booked'].includes(diagnosticSlotStatus)) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    diagnosticSlotStatus = 'booked'
    return new Response(JSON.stringify([{ id: 42 }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes(`/rest/v1/coaching_sessions?id=eq.${firstConsultationSessionId}`)) {
    return new Response(JSON.stringify([{
      id: firstConsultationSessionId,
      starts_at: '2026-08-10T08:00:00.000Z',
      ends_at: '2026-08-10T08:45:00.000Z',
      timezone: 'Europe/Zurich',
      google_event_id: null,
      meet_url: null,
      coaching_clients: { id: '10000000-0000-4000-8000-000000000002', first_name: 'Camille', last_name: '', email: 'camille@example.test' },
      coaching_coaches: { id: '10000000-0000-4000-8000-000000000009', slug: 'romain', first_name: 'Romain', last_name: '', email: 'romain@example.test', google_calendar_id: 'primary' }
    }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_google_connections?')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_sessions?engagement_id=')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
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
    lastMailerPayload = JSON.parse(options.body)
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

const missingAmountPayload = JSON.stringify({
  order_id: 'spiffy-order-without-amount',
  checkout_id: 'followup-checkout-1',
  email: 'camille@example.test',
  name_first: 'Camille'
})
const missingAmountSignature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${missingAmountPayload}`).digest('base64')
const originalConsoleError = console.error
console.error = () => {}
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${missingAmountSignature}`
  },
  body: missingAmountPayload
}))
console.error = originalConsoleError
assert.equal(response.status, 500)
assert.equal(orderRecordCalls, 0)

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
assert.ok(lastMailerPayload.html.includes('https://coaching.sonnycourt.com/activer?token='))

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

const refundPayload = JSON.stringify({
  event: 'order.refunded',
  order_id: 'spiffy-order-247',
  checkout_id: 'followup-checkout-1',
  email: 'camille@example.test'
})
const refundSignature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${refundPayload}`).digest('base64')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${refundSignature}`
  },
  body: refundPayload
}))
const refundBody = await body(response)
assert.equal(response.status, 200)
assert.equal(refundBody.type, 'coaching_refund')
assert.equal(refundBody.integrations.calendar.status, 'done')
assert.equal(refundRpcCalls, 1)

activationDeliveryAlreadySent = false
const firstConsultationPayload = JSON.stringify({
  order_id: 'spiffy-first-consultation-001',
  checkout_id: '39602',
  coach_booking_token: '10000000-0000-4000-8000-000000000007',
  order_total: '97.00',
  currency: 'EUR',
  email: 'camille@example.test',
  name_first: 'Camille'
})
const firstConsultationSignature = crypto.createHmac('sha256', signatureSecretBytes).update(`${webhookId}.${timestamp}.${firstConsultationPayload}`).digest('base64')
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${firstConsultationSignature}`
  },
  body: firstConsultationPayload
}))
const firstConsultationBody = await body(response)
assert.equal(response.status, 200)
assert.equal(firstConsultationBody.type, 'paid')
assert.equal(firstConsultationBody.coaching.type, 'coaching_order')
assert.equal(firstConsultationBody.session.status, 'imported')
assert.equal(firstConsultationBody.session.session_id, firstConsultationSessionId)
assert.equal(firstConsultationBody.session.integrations.calendar.status, 'not_configured')
assert.equal(recordedOrderPayload.p_offer_slug, 'first-consultation')
assert.equal(recordedOrderPayload.p_amount_cents, 9700)
assert.equal(mailerSendCalls, 4)
assert.equal(firstConsultationImportCalls, 1)

activationDeliveryAlreadySent = true
diagnosticBookingExpiresAt = new Date(Date.now() - 600000).toISOString()
response = await spiffyWebhook(request('http://localhost/.netlify/functions/coach-spiffy-webhook?event=purchase', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': webhookId,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${firstConsultationSignature}`
  },
  body: firstConsultationPayload
}))
const repeatedFirstConsultationBody = await body(response)
assert.equal(response.status, 200)
assert.equal(repeatedFirstConsultationBody.type, 'paid')
assert.equal(repeatedFirstConsultationBody.session.session_id, firstConsultationSessionId)
assert.equal(diagnosticSlotStatus, 'booked')
assert.equal(firstConsultationImportCalls, 2)
assert.equal(mailerSendCalls, 4)

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MAILERSEND_API_KEY', 'COACHING_EMAIL_FROM', 'SPIFFY_COACHING_SESSION_1_IDS', 'SPIFFY_ES2_COMPLETE_IDS', 'SPIFFY_FIRST_CONSULTATION_IDS', 'URL']) delete process.env[key]
globalThis.fetch = async () => {
  throw new Error('Aucun appel réseau ne doit partir pendant ces tests')
}

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
process.env.MAILERSEND_API_KEY = 'mailersend-test'
process.env.COACHING_EMAIL_FROM = 'coaching@example.test'
process.env.GOOGLE_COACHING_CLIENT_ID = 'google-client-test'
process.env.GOOGLE_COACHING_CLIENT_SECRET = 'google-secret-test'
process.env.GOOGLE_ROMAIN_REFRESH_TOKEN = 'legacy-refresh-token-test'
const integrationSessionId = '20000000-0000-4000-8000-000000000001'
let integrationFinalized = false
let calendarCreates = 0
let integrationEmails = 0
const integrationEmailPayloads = []
const deliveredKinds = new Set()
globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  if (target.includes('/rest/v1/coaching_sessions?') && options.method === 'PATCH') {
    integrationFinalized = true
    return new Response(JSON.stringify([{ id: integrationSessionId }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_sessions?')) {
    return new Response(JSON.stringify([{
      id: integrationSessionId,
      starts_at: '2026-08-10T08:00:00.000Z',
      ends_at: '2026-08-10T09:00:00.000Z',
      timezone: 'Europe/Zurich',
      google_event_id: integrationFinalized ? `c${integrationSessionId.replaceAll('-', '')}` : null,
      meet_url: integrationFinalized ? 'https://meet.google.com/test-room' : null,
      coaching_clients: { id: '20000000-0000-4000-8000-000000000002', first_name: 'Camille', last_name: 'Test', email: 'camille@example.test' },
      coaching_coaches: { id: '20000000-0000-4000-8000-000000000003', slug: 'romain', first_name: 'Romain', last_name: 'Coach', email: 'romain@example.test', phone: '+33 6 12 34 56 78', country: 'FR', google_calendar_id: 'primary' }
    }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_google_connections?')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target === 'https://oauth2.googleapis.com/token') {
    return new Response(JSON.stringify({ access_token: 'google-access-test' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('www.googleapis.com/calendar/v3/calendars/primary/events?')) {
    calendarCreates += 1
    const sent = JSON.parse(options.body)
    assert.equal(sent.id, `c${integrationSessionId.replaceAll('-', '')}`)
    return new Response(JSON.stringify({ id: sent.id, hangoutLink: 'https://meet.google.com/test-room' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.includes('/rest/v1/coaching_email_deliveries?')) {
    const kind = new URL(target).searchParams.get('kind')?.replace(/^eq\./, '')
    return new Response(JSON.stringify(deliveredKinds.has(kind) ? [{ id: `delivery-${kind}` }] : []), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target === 'https://api.mailersend.com/v1/email') {
    integrationEmails += 1
    integrationEmailPayloads.push(JSON.parse(options.body))
    return new Response('', { status: 202 })
  }
  if (target.endsWith('/rest/v1/coaching_email_deliveries') && options.method === 'POST') {
    const payload = JSON.parse(options.body)
    deliveredKinds.add(payload.kind)
    return new Response(JSON.stringify([{ id: `delivery-${payload.kind}` }]), { status: 201, headers: { 'content-type': 'application/json' } })
  }
  throw new Error(`Appel réseau inattendu pendant le test intégrations: ${target}`)
}
const firstFinalization = await finalizeCoachingBooking(integrationSessionId)
assert.equal(firstFinalization.calendar.status, 'created')
assert.equal(calendarCreates, 1)
assert.equal(integrationEmails, 2)
assert.ok(integrationEmailPayloads.find((payload) => payload.to?.[0]?.email === 'camille@example.test')?.html.includes('https://wa.me/33612345678'))
assert.ok(integrationEmailPayloads.find((payload) => payload.to?.[0]?.email === 'camille@example.test')?.text.includes('+33 6 12 34 56 78'))
const repeatedFinalization = await finalizeCoachingBooking(integrationSessionId)
assert.equal(repeatedFinalization.calendar.status, 'already_created')
assert.equal(repeatedFinalization.client_email.status, 'already_sent')
assert.equal(repeatedFinalization.coach_email.status, 'already_sent')
assert.equal(calendarCreates, 1)
assert.equal(integrationEmails, 2)

for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MAILERSEND_API_KEY', 'COACHING_EMAIL_FROM', 'GOOGLE_COACHING_CLIENT_ID', 'GOOGLE_COACHING_CLIENT_SECRET', 'GOOGLE_ROMAIN_REFRESH_TOKEN']) delete process.env[key]
globalThis.fetch = async () => {
  throw new Error('Aucun appel réseau ne doit partir pendant ces tests')
}

process.env.COACHING_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(48).toString('base64url')
const encrypted = encryptCoachingSecret('refresh-token-test')
assert.notEqual(encrypted, 'refresh-token-test')
assert.equal(decryptCoachingSecret(encrypted), 'refresh-token-test')

console.log(JSON.stringify({
  fail_closed_endpoints: 13,
  staff_activation_guard: 'ok',
  preparation_gate: 'ok',
  webhook_signature: 'ok',
  webhook_private_token: 'ok',
  webhook_freshness: 'ok',
  explicit_spiffy_event: 'ok',
  unknown_checkouts_rejected: 'ok',
  failed_orders_rejected: 'ok',
  spiffy_purchase_contract: 'ok',
  first_consultation_bridge: 'ok',
  webhook_amount_required: 'ok',
  activation_email_idempotency: 'ok',
  booking_integration_idempotency: 'ok',
  refund_calendar_cleanup: 'ok',
  webhook_data_minimization: 'ok',
  stripe_signature: 'ok',
  token_encryption: 'ok',
  network_calls: 0
}))
