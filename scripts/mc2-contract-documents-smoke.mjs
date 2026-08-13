import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  buildMc2ContractDocumentSnapshot,
  mc2PaidSessionIsEligible,
  queueMc2ContractDocument,
  renderMc2ContractDocument,
} from '../netlify/functions/lib/mc2-contract-documents.mjs';
import contractDocumentHandler from '../netlify/functions/mc2-contract-document.js';
import {
  MC2_CONTRACT_TOTAL_CENTS,
  MC2_ENTRY_PAYMENT_CENTS,
  MC2_PAYMENT_PLAN,
} from '../netlify/functions/lib/mc2-stripe.mjs';

const termsSha = '2a2bc31df89646146de1acfe691c2c79cd9d32c2da5556b8ba86e7dbda6a7e99';
const env = {
  MC2_CONTRACT_DOCUMENTS_ENABLED: 'true',
  MC2_CONTRACT_VERSION: 'mc2-cgv-2026-08-v3',
  MC2_TERMS_URL: 'https://sonnycourt.com/cgv/',
  MC2_TERMS_SNAPSHOT_URL: 'https://sonnycourt.com/legal-archives/mc2-cgv-2026-08-v3.pdf',
  MC2_TERMS_SNAPSHOT_SHA256: termsSha,
};
const registration = {
  token: 'registration-secret-not-public',
  email: 'buyer-secret@example.com',
  prenom: 'Acheteur Secret',
};
const paidSession = {
  id: 'cs_secret_not_public',
  mode: 'payment',
  payment_status: 'paid',
  amount_total: MC2_ENTRY_PAYMENT_CENTS,
  currency: 'eur',
  metadata: {
    system: 'es2_mc2',
    payment_plan: MC2_PAYMENT_PLAN,
    contractual_total_cents: String(MC2_CONTRACT_TOTAL_CENTS),
    mc2_token: registration.token,
  },
};
const event = { id: 'evt_secret_not_public', created: 1_786_291_200 };

assert.equal(mc2PaidSessionIsEligible(paidSession), true);
assert.equal(mc2PaidSessionIsEligible({ ...paidSession, payment_status: 'unpaid' }), false, 'unpaid refused');
assert.equal(mc2PaidSessionIsEligible({ ...paidSession, metadata: { ...paidSession.metadata, system: 'other' } }), false, 'other product refused');
assert.equal(mc2PaidSessionIsEligible({ ...paidSession, amount_total: 29700 }), false, 'wrong entry amount refused');
assert.equal(buildMc2ContractDocumentSnapshot({ session: { ...paidSession, payment_status: 'unpaid' }, event, env }), null);

const snapshot = buildMc2ContractDocumentSnapshot({ session: paidSession, event, env });
assert.equal(snapshot.verified_paid_at_creation, true);
assert.equal(snapshot.pricing.total_cents, 123500);
assert.equal(snapshot.pricing.paid_at_purchase_cents, 4700);
assert.equal(snapshot.pricing.remaining_scheduled_cents, 118800);
assert.deepEqual(snapshot.schedule.map((row) => row.due_offset_days), [0, 14, 35, 56, 77]);
assert.deepEqual(snapshot.schedule.map((row) => row.amount_cents), [4700, 29700, 29700, 29700, 29700]);
assert.equal(snapshot.schedule.at(-1).due_at, new Date((event.created * 1_000) + 77 * 86400000).toISOString());

const html = renderMc2ContractDocument(snapshot);
assert.match(html, /noindex,nofollow,noarchive/);
assert.match(html, /Imprimer \/ enregistrer en PDF/);
assert.match(html, /Télécharger une copie HTML/);
assert.match(html, /1[\s ]235\s€/);
assert.match(html, /J\+14, J\+35, J\+56 et J\+77/);
assert.match(html, /Modèle à copier dans un email ou un courrier/);
assert.match(html, /ArgEntrepreneur Sàrl/);
assert.match(html, new RegExp(termsSha));
for (const secret of [registration.email, registration.prenom, registration.token, paidSession.id, event.id, 'payment_intent', 'stripe_customer']) {
  assert.equal(html.includes(secret), false, `public output leaked ${secret}`);
}
assert.equal(renderMc2ContractDocument(snapshot), html, 'same immutable HTML for view and download');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
const originalFetch = globalThis.fetch;
const persisted = [];
const queryHashes = [];
let tableFetches = 0;
const response = (data, status = 200) => new Response(data == null ? null : JSON.stringify(data), {
  status,
  headers: data == null ? {} : { 'Content-Type': 'application/json' },
});

try {
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.host !== 'supabase.test') throw new Error(`Unexpected host ${url.host}`);
    tableFetches += 1;
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(url.searchParams.get('on_conflict'), 'registration_token');
      assert.equal(body.snapshot.verified_paid_at_creation, true);
      assert.equal(JSON.stringify(body.snapshot).includes(registration.email), false);
      if (!persisted.length) {
        persisted.push({ id: 41, ...body });
        return response([persisted[0]], 201);
      }
      return response([], 201);
    }
    if (url.searchParams.has('registration_token')) return response([persisted[0]]);
    const hash = url.searchParams.get('access_token_hash')?.replace(/^eq\./, '');
    queryHashes.push(hash || '');
    const row = persisted.find((item) => item.access_token_hash === hash);
    return response(row ? [{ snapshot: row.snapshot, rendered_html: row.rendered_html }] : []);
  };

  const first = await queueMc2ContractDocument({ registration, session: paidSession, event, env });
  const second = await queueMc2ContractDocument({ registration, session: paidSession, event, env });
  assert.deepEqual({ queued: first.queued, id: first.id }, { queued: true, id: 41 });
  assert.deepEqual({ queued: second.queued, id: second.id }, { queued: false, id: 41 });
  assert.equal(persisted.length, 1, 'duplicate webhook creates one durable document');

  const accessToken = persisted[0].access_token;
  assert.match(accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(accessToken, registration.token);
  assert.equal(persisted[0].access_token_hash, crypto.createHash('sha256').update(accessToken).digest('hex'));

  const validResponse = await contractDocumentHandler(new Request(
    `https://sonnycourt.com/documents-contractuels/${accessToken}?token=${accessToken}`,
  ));
  assert.equal(validResponse.status, 200);
  assert.equal(validResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(validResponse.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(validResponse.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(validResponse.headers.get('x-frame-options'), 'DENY');
  assert.equal(validResponse.headers.get('content-type'), 'text/html; charset=utf-8');
  const validHtml = await validResponse.text();
  assert.match(validHtml, new RegExp(persisted[0].snapshot.document_reference));

  const beforeInvalid = tableFetches;
  const invalidResponse = await contractDocumentHandler(new Request(
    'https://sonnycourt.com/.netlify/functions/mc2-contract-document?token=invalid',
  ));
  assert.equal(invalidResponse.status, 404);
  assert.equal(tableFetches, beforeInvalid, 'malformed token does not query storage');

  const otherToken = 'B'.repeat(43);
  const otherSnapshot = structuredClone(snapshot);
  otherSnapshot.document_reference = 'MC2-OTHER-CUSTOMER';
  persisted.push({
    access_token_hash: crypto.createHash('sha256').update(otherToken).digest('hex'),
    snapshot: otherSnapshot,
    rendered_html: renderMc2ContractDocument(otherSnapshot),
  });
  const crossResponse = await contractDocumentHandler(new Request(
    `https://sonnycourt.com/.netlify/functions/mc2-contract-document?token=${otherToken}`,
  ));
  const crossHtml = await crossResponse.text();
  assert.equal(crossResponse.status, 200);
  assert.match(crossHtml, /MC2-OTHER-CUSTOMER/);
  assert.equal(crossHtml.includes(persisted[0].snapshot.document_reference), false, 'bearer token cannot cross records');

  const downloadResponse = await contractDocumentHandler(new Request(
    `https://sonnycourt.com/.netlify/functions/mc2-contract-document?token=${accessToken}&download=1`,
  ));
  assert.match(downloadResponse.headers.get('content-disposition'), /^attachment; filename="MC2-/);
  assert.equal(await downloadResponse.text(), validHtml, 'download is the exact frozen page');
  assert.equal(queryHashes.includes(accessToken), false, 'storage only receives a token hash');
} finally {
  globalThis.fetch = originalFetch;
}

const sql = fs.readFileSync(new URL('../sql/mc2_contract_documents.sql', import.meta.url), 'utf8');
assert.match(sql, /enable row level security/i);
assert.match(sql, /snapshot is distinct from old\.snapshot/i);
assert.match(sql, /raise exception 'MC2 contract document snapshots are immutable'/i);
assert.match(sql, /unique \(registration_token\)/i);
assert.doesNotMatch(sql, /grant\s+.+\s+to\s+(anon|authenticated)/i);

console.log(JSON.stringify({
  paid_only: 'ok',
  product_scope: 'ok',
  exact_frozen_schedule: 'ok',
  invalid_token: 'ok',
  cross_access: 'ok',
  duplicate_webhook: 'ok',
  no_sensitive_public_data: 'ok',
  noindex_no_store: 'ok',
  print_download: 'ok',
  immutable_sql: 'ok',
}, null, 2));
