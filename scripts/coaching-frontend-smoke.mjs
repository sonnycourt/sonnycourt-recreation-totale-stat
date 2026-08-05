import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const read = async (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const { coachingUrl, isCoachingAppHost } = await import('../src/scripts/coaching-routes.js')

const portal = await read('src/scripts/coaching-portal.js')
const auth = await read('src/scripts/coaching-supabase.js')
const callback = await read('src/scripts/coaching-auth-callback.js')
const reset = await read('src/scripts/coaching-reset-password.js')
const activation = await read('src/scripts/coaching-activate-account.js')
const coachConsole = await read('src/scripts/coach-console.js')
const coachConsolePage = await read('src/pages/coach-console.astro')
const combinedAuth = [portal, auth, callback, reset, activation].join('\n')
const netlify = await read('netlify.toml')
const googleCallback = await read('netlify/functions/coaching-google-callback.js')
const spiffyWebhook = await read('netlify/functions/coach-spiffy-webhook.js')
const stripeCheckout = await read('netlify/functions/coaching-stripe-checkout.js')
const stripePayment = await read('src/scripts/coaching-stripe-payment.js')
const firstConsultationPayment = await read('src/pages/coach-romain/paiement.astro')
const diagnostic = await read('src/pages/coach-romain/diagnostic.astro')

assert.match(portal, /signInWithPassword/)
assert.match(portal, /signInWithOAuth/)
assert.match(portal, /provider:\s*['"]google['"]/)
assert.match(portal, /resetPasswordForEmail/)
assert.match(callback, /exchangeCodeForSession/)
assert.match(reset, /updateUser\(\{ password \}\)/)
assert.doesNotMatch(combinedAuth, /signInWithOtp|magic.?link/i)
assert.match(coachConsolePage, /data-new-action/)
assert.match(coachConsolePage, /id="action-form"/)
assert.match(coachConsole, /from\(['"]coaching_actions['"]\)\.insert/)
assert.match(coachConsole, /from\(['"]coaching_actions['"]\)\.update/)

for (const role of ['owner', 'coach', 'client']) assert.match(auth, new RegExp(`${role}:`))
for (const page of [
  'src/pages/coaching/index.astro',
  'src/pages/coaching/admin.astro',
  'src/pages/coach-console.astro',
  'src/pages/coaching/eleve.astro',
  'src/pages/coaching/credits.astro',
  'src/pages/coaching/paiement.astro',
  'src/pages/coaching/compte.astro',
  'src/pages/coaching/preparation.astro',
  'src/pages/coaching/reserver.astro',
  'src/pages/coaching/confirmation.astro',
  'src/pages/coaching/achat-confirme.astro',
  'src/pages/coaching/activer.astro',
  'src/pages/coaching/reset-password.astro',
  'src/pages/coaching/auth/callback.astro',
]) await fs.access(new URL(`../${page}`, import.meta.url))

const wallet = await read('src/scripts/coaching-credits.js')
const account = await read('src/scripts/coaching-account.js')
const student = await read('src/scripts/coaching-student.js')
assert.match(wallet, /coaching_credit_balance/)
assert.match(wallet, /membership-6|coaching_subscriptions/)
assert.match(account, /coaching_update_my_profile/)
assert.match(account, /coaching-avatars/)
assert.match(student, /data-continuation-prompt|openContinuationPrompt/)
assert.match(student, /coaching_submit_session_review/)
assert.match(student, /pendingReviewSessionId/)
assert.match(wallet, /coaching-stripe-portal/)
assert.match(wallet, /\/coaching\/paiement\?offer=/)
assert.match(stripeCheckout, /ui_mode:\s*['"]custom['"]/)
assert.match(stripePayment, /initCheckout/)
assert.match(stripePayment, /createPaymentElement/)
assert.match(stripePayment, /\.confirm\(\)/)
assert.match(firstConsultationPayment, /js\.stripe\.com\/basil\/stripe\.js/)
assert.doesNotMatch([firstConsultationPayment, diagnostic].join('\n'), /Spiffy/i)
assert.equal(isCoachingAppHost('coaching.sonnycourt.com'), true)
assert.equal(isCoachingAppHost('sonnycourt.com'), false)
assert.equal(coachingUrl('/coaching', 'coaching.sonnycourt.com'), '/')
assert.equal(coachingUrl('/coaching/eleve?preview=1', 'coaching.sonnycourt.com'), '/eleve?preview=1')
assert.equal(coachingUrl('/coach-console#clients', 'coaching.sonnycourt.com'), '/coach#clients')
assert.equal(coachingUrl('/coaching/eleve', 'localhost'), '/coaching/eleve')
for (const route of ['admin', 'coach', 'eleve', 'credits', 'paiement', 'compte', 'preparation', 'reserver', 'confirmation', 'achat-confirme', 'activer', 'reset-password', 'auth/callback']) {
  assert.ok(netlify.includes(`from = "https://coaching.sonnycourt.com/${route}"`))
}
assert.match(netlify, /https:\/\/sonnycourt\.com\/coaching\/\*/)
assert.match(googleCallback, /coachingAppUrl\(`\/coach/)
assert.match(spiffyWebhook, /coachingAppUrl\(`\/activer/)

for (const endpoint of [
  'netlify/functions/coaching-activate-account.js',
  'netlify/functions/coaching-book-session.js',
  'netlify/functions/coaching-cancel-session.js',
  'netlify/functions/coaching-google-connect.js',
  'netlify/functions/coaching-google-callback.js',
  'netlify/functions/coaching-sync-availability.js',
  'netlify/functions/coaching-review-reminders.js',
  'netlify/functions/coaching-stripe-checkout.js',
  'netlify/functions/coaching-stripe-portal.js',
  'netlify/functions/coaching-stripe-webhook.js',
  'netlify/functions/coach-spiffy-webhook.js',
]) await fs.access(new URL(`../${endpoint}`, import.meta.url))

console.log(JSON.stringify({
  password_auth: 'ok',
  google_sso: 'ok',
  password_recovery: 'ok',
  magic_links: 'absent',
  role_routing: ['owner', 'coach', 'client'],
  coach_actions: 'persistent',
  coaching_subdomain: 'ready',
  portal_pages: 15,
  server_endpoints: 11,
}))
