import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const read = async (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const portal = await read('src/scripts/coaching-portal.js')
const auth = await read('src/scripts/coaching-supabase.js')
const callback = await read('src/scripts/coaching-auth-callback.js')
const reset = await read('src/scripts/coaching-reset-password.js')
const activation = await read('src/scripts/coaching-activate-account.js')
const combinedAuth = [portal, auth, callback, reset, activation].join('\n')

assert.match(portal, /signInWithPassword/)
assert.match(portal, /signInWithOAuth/)
assert.match(portal, /provider:\s*['"]google['"]/)
assert.match(portal, /resetPasswordForEmail/)
assert.match(callback, /exchangeCodeForSession/)
assert.match(reset, /updateUser\(\{ password \}\)/)
assert.doesNotMatch(combinedAuth, /signInWithOtp|magic.?link/i)

for (const role of ['owner', 'coach', 'client']) assert.match(auth, new RegExp(`${role}:`))
for (const page of [
  'src/pages/coaching/index.astro',
  'src/pages/coaching/admin.astro',
  'src/pages/coach-console.astro',
  'src/pages/coaching/eleve.astro',
  'src/pages/coaching/preparation.astro',
  'src/pages/coaching/reserver.astro',
  'src/pages/coaching/confirmation.astro',
  'src/pages/coaching/activer.astro',
  'src/pages/coaching/reset-password.astro',
  'src/pages/coaching/auth/callback.astro',
]) await fs.access(new URL(`../${page}`, import.meta.url))

for (const endpoint of [
  'netlify/functions/coaching-activate-account.js',
  'netlify/functions/coaching-book-session.js',
  'netlify/functions/coaching-cancel-session.js',
  'netlify/functions/coaching-google-connect.js',
  'netlify/functions/coaching-google-callback.js',
  'netlify/functions/coaching-sync-availability.js',
  'netlify/functions/coach-spiffy-webhook.js',
]) await fs.access(new URL(`../${endpoint}`, import.meta.url))

console.log(JSON.stringify({
  password_auth: 'ok',
  google_sso: 'ok',
  password_recovery: 'ok',
  magic_links: 'absent',
  role_routing: ['owner', 'coach', 'client'],
  portal_pages: 10,
  server_endpoints: 7,
}))
