import fs from 'node:fs';

const reviewsPath = new URL('../src/data/reviews.json', import.meta.url);
const orderPath = new URL('../src/data/review-conversion-order.json', import.meta.url);
const { reviews } = JSON.parse(fs.readFileSync(reviewsPath, 'utf8'));
const { filters } = JSON.parse(fs.readFileSync(orderPath, 'utf8'));

const visible = reviews.filter((review) => Boolean(review.first_name));
const byId = new Map(visible.map((review) => [review.id, review]));
const expectedFilters = {
  all: visible,
  5: visible.filter((review) => review.rating === 5),
  4: visible.filter((review) => review.rating === 4),
  3: visible.filter((review) => review.rating === 3),
  2: visible.filter((review) => review.rating === 2),
  1: visible.filter((review) => review.rating === 1),
  unrated: visible.filter((review) => review.rating == null),
};

for (const [filter, expectedReviews] of Object.entries(expectedFilters)) {
  const order = filters[filter];
  if (!Array.isArray(order)) throw new Error(`Ordre manquant pour le filtre ${filter}`);
  if (new Set(order).size !== order.length) throw new Error(`Doublon dans le filtre ${filter}`);

  const expectedIds = new Set(expectedReviews.map((review) => review.id));
  const actualIds = new Set(order);
  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  const unexpected = [...actualIds].filter((id) => !expectedIds.has(id));
  if (missing.length || unexpected.length) {
    throw new Error(`${filter}: manquants=${missing.join(',')} inattendus=${unexpected.join(',')}`);
  }

  for (const id of order) {
    const review = byId.get(id);
    if (!review) throw new Error(`${filter}: avis inconnu ${id}`);
    if (filter === 'unrated' && review.rating != null) throw new Error(`${id} devrait être sans note`);
    if (/^[1-5]$/.test(filter) && review.rating !== Number(filter)) {
      throw new Error(`${id} ne correspond pas au filtre ${filter}`);
    }
  }
}

console.log(`OK: ${visible.length} avis, ordres complets pour ${Object.keys(expectedFilters).length} filtres.`);
