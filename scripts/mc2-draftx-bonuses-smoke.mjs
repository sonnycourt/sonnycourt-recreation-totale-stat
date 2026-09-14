import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run after the build: check the actual generated markup without a browser.
const html = readFileSync(new URL('../dist/mc2/draftx/index.html', import.meta.url), 'utf8');
const cards = [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
  .filter(([, attrs]) => /class="es2-bonus-card(?:\s|")/.test(attrs))
  .map(([, , body]) => ({
    number: body.match(/class="es2-bonus-index"[^>]*>[\s\S]*?<strong[^>]*>(\d+)<\/strong>/)?.[1],
    title: body.match(/<h3\b[^>]*class="es2-bonus-name"[^>]*>(.*?)<\/h3>/)?.[1],
    value: Number(body.match(/class="es2-bonus-val-amount"[^>]*>([\d\s]+)€/u)?.[1].replaceAll(' ', '')),
  }));

assert.deepEqual(cards.map(card => card.number), ['01', '02', '03', '04', '05']);
assert.deepEqual(cards.map(card => card.title), [
  '3 coachings manifestation en visio',
  'Ton compagnon IA Morpho',
  '5 méthodes pour te libérer des traumas passés',
  'La communauté Volt (à vie)',
  'Consultation privée avec Sonny Court',
]);
assert.equal(cards[2].value, 297);
assert.equal(cards.reduce((total, card) => total + card.value, 0), 3938);
assert.match(html, /5 BONUS EXCLUSIFS/);
assert.match(html, /Les 5 bonus exclusifs/);
assert.match(html, /3 938 €/);
assert.match(html, /8 723 €/);
assert.doesNotMatch(html, /3 838 €|8 623 €/);
assert.doesNotMatch(html, /7 bonus|7 BONUS|6 332 €|11 117 €/);
assert.doesNotMatch(html, /<article\b[^>]*es2-bonus-card--(?:books-proof|method-x-proof)/);
assert.doesNotMatch(html, /<img\b[^>]*src="\/media\/deal-(?:ancient-books-transparent|methode-x)\.webp"/);
console.log('PASS — 5 bonus rendus dans l’ordre, anciens 4 et 7 masqués, consultation en dernier et valeurs alignées.');
