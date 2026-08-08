import assert from 'node:assert/strict';
import { addPayNote, normalizePayNotesStore, payNotesEntityKey, removePayNote } from '../src/scripts/pay-resource-notes.js';

const firstKey = payNotesEntityKey('orders', 'stripe', ['Commande test', 'client@example.test', 'Stripe']);
const repeatedKey = payNotesEntityKey('orders', 'stripe', ['Commande test', 'client@example.test', 'Stripe']);
const otherKey = payNotesEntityKey('orders', 'paypal', ['Commande test', 'client@example.test', 'PayPal']);
assert.equal(firstKey, repeatedKey);
assert.notEqual(firstKey, otherKey);
assert.match(firstKey, /^orders:stripe:[a-f0-9]{8}$/);
assert.equal(firstKey.includes('client@'), false);

let store = addPayNote({}, firstKey, ' Relancer le client demain. ', { id: 'note-1', createdAt: '2026-08-09T10:00:00Z' });
store = addPayNote(store, firstKey, 'Deuxième note', { id: 'note-2', createdAt: '2026-08-09T11:00:00Z' });
assert.deepEqual(store[firstKey].map((note) => note.id), ['note-2', 'note-1']);
assert.equal(store[firstKey][1].body, 'Relancer le client demain.');

store = removePayNote(store, firstKey, 'note-2');
assert.deepEqual(store[firstKey].map((note) => note.id), ['note-1']);
store = removePayNote(store, firstKey, 'note-1');
assert.equal(store[firstKey], undefined);

assert.deepEqual(normalizePayNotesStore({ invalid: [{ id: 'x', body: 'y' }], [firstKey]: [{ id: '', body: 'vide' }, { id: 'ok', body: 'valide', createdAt: 'bad-date' }] }), {
  [firstKey]: [{ id: 'ok', body: 'valide', createdAt: '1970-01-01T00:00:00.000Z' }],
});

console.log(JSON.stringify({
  stable_entity_keys: 'ok',
  pii_free_keys: 'ok',
  note_normalization: 'ok',
  safe_removal: 'ok',
}, null, 2));

