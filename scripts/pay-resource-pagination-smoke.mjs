import assert from 'node:assert/strict';
import {
  clampPayPage,
  normalizePayPageSize,
  payPageButtons,
  payPageCount,
  payPageItems,
} from '../src/scripts/pay-resource-pagination.js';

assert.equal(normalizePayPageSize('50'), 50);
assert.equal(normalizePayPageSize('17'), 25);
assert.equal(payPageCount(1_557, 25), 63);
assert.equal(clampPayPage(99, 51, 25), 3);

const page = payPageItems(Array.from({ length: 63 }, (_, index) => index + 1), 2, 25);
assert.deepEqual(page.items, Array.from({ length: 25 }, (_, index) => index + 26));
assert.deepEqual({ page: page.page, pageCount: page.pageCount, start: page.start, end: page.end, total: page.total }, {
  page: 2, pageCount: 3, start: 26, end: 50, total: 63,
});
assert.deepEqual(payPageItems([], 4, 25), { items: [], page: 1, pageSize: 25, pageCount: 1, total: 0, start: 0, end: 0 });
assert.deepEqual(payPageButtons(1, 10), [1, 2, 3, 4, 'ellipsis', 10]);
assert.deepEqual(payPageButtons(5, 10), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
assert.deepEqual(payPageButtons(10, 10), [1, 'ellipsis', 7, 8, 9, 10]);

console.log('Pagination Pay validée: grandes listes découpées sans modifier le filtre ni l’export.');
