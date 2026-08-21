import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import statusHandler from '../netlify/functions/mc2-spiffy-status.js';

const page = await fs.readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8');
const success = await fs.readFile(new URL('../src/pages/commencer/succes.astro', import.meta.url), 'utf8');
const legacySuccess = await fs.readFile(new URL('../src/pages/es2-derniere-etape.astro', import.meta.url), 'utf8');
const billing = await fs.readFile(new URL('../netlify/functions/mc2-billing-info.js', import.meta.url), 'utf8');

assert.match(page, /spiffy\.load\(["']sonnycourt["']\)/);
assert.match(page, /monthly:\s*'https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-2-2-1'/);
assert.match(page, /once:\s*'https:\/\/sonnycourt\.spiffy\.co\/checkout\/esprit-subconscient-2-0-34'/);
assert.match(page, /document\.createElement\(['"]spiffy-checkout['"]\)/);
assert.match(page, /url\.searchParams\.set\(['"]name_first['"],\s*reg\.prenom\)/);
assert.match(page, /url\.searchParams\.set\(['"]email['"],\s*reg\.email\)/);
assert.match(page, /url\.searchParams\.set\(['"]country['"],\s*reg\.pays\)/);

assert.match(success, /provider === 'spiffy'/);
assert.match(success, /mc2-spiffy-status/);
assert.match(success, /localStorage\.getItem\('mc2_registration_token'\)/);
assert.match(success, /provider,/);
assert.match(legacySuccess, /commencer\/succes\/\?provider=spiffy/);
assert.match(billing, /provider === 'spiffy'/);
assert.match(billing, /registration\.payment_status !== 'paid'/);

const originalFetch = globalThis.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
globalThis.fetch = async () => Response.json([{
  token: 'a'.repeat(32),
  prenom: 'Test',
  telephone: '+41780000000',
  pays: 'CH',
  statut: 'purchased',
  payment_status: 'paid',
  initial_payment_cents: 19700,
  contractual_total_cents: 236400,
}]);
try {
  const response = await statusHandler(new Request(`https://sonnycourt.com/.netlify/functions/mc2-spiffy-status?t=${'a'.repeat(32)}`));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.paid, true);
  assert.equal(payload.schedule_ready, true);
  assert.equal(payload.amount_total, 19700);
} finally {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
}

console.log(JSON.stringify({
  embedded_spiffy: 'ok',
  monthly_and_once: 'ok',
  mc2_prefill: 'ok',
  post_purchase_address: 'provider_aware',
}, null, 2));
