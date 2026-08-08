import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findPayDraft, payDraftEditUrl, readPayDrafts, removePayDraft, upsertPayDraft } from '../src/scripts/pay-draft-store.js';

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };

upsertPayDraft(storage, 'products', { id: 101, name: 'Original', amount: 97 });
upsertPayDraft(storage, 'products', { id: 102, name: 'Second', amount: 47 });
upsertPayDraft(storage, 'products', { id: 101, name: 'Modifié', amount: 197 });
assert.deepEqual(readPayDrafts(storage, 'products').map((row) => row.id), [101, 102]);
assert.equal(findPayDraft(storage, 'products', '101').name, 'Modifié');
assert.equal(removePayDraft(storage, 'products', '101').removed, true);
assert.equal(removePayDraft(storage, 'products', '101').removed, false);
assert.equal(findPayDraft(storage, 'products', '101'), null);
assert.equal(payDraftEditUrl('checkouts', 42, { preview: true }), '/pay/checkouts/new?draft=42&preview=1');
assert.throws(() => payDraftEditUrl('unknown', 42), /pay_draft_kind_invalid/);
assert.throws(() => payDraftEditUrl('products', '../bad'), /pay_draft_id_invalid/);

for (const [file, kind] of [
  ['../src/pages/pay/checkouts/new.astro', 'checkouts'],
  ['../src/pages/pay/products/new.astro', 'products'],
  ['../src/pages/pay/discounts/new.astro', 'discounts'],
]) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, new RegExp(`findPayDraft\\(localStorage, '${kind}'`));
  assert.match(source, new RegExp(`upsertPayDraft\\(localStorage, '${kind}'`));
  assert.match(source, /Enregistrer les modifications/);
}
const resourcePage = fs.readFileSync(new URL('../src/scripts/pay-resource-pages.js', import.meta.url), 'utf8');
assert.match(resourcePage, /Confirmer la suppression/);
assert.match(resourcePage, /removePayDraft\(localStorage/);

console.log(JSON.stringify({ draft_upsert: 'ok', checkout_edit: 'ok', product_edit: 'ok', discount_edit: 'ok', duplicate_guard: 'ok', two_step_delete: 'ok', safe_edit_url: 'ok' }, null, 2));
