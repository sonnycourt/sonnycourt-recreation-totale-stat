import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const registryPath = resolve(projectRoot, 'src/data/reviews.json');
const batchPath = process.argv[2];

if (!batchPath) {
  throw new Error('Usage : node scripts/import-review-batch.mjs <fichier-json>');
}

const normalize = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const batch = JSON.parse(await readFile(resolve(batchPath), 'utf8'));
const knownIds = new Set(registry.reviews.map((review) => review.id));
const knownTexts = new Set(registry.reviews.map((review) => normalize(review.review)));
const imported = [];
const skipped = [];

for (const review of batch.reviews) {
  const textKey = normalize(review.review);
  if (!review.id || !textKey || knownIds.has(review.id) || knownTexts.has(textKey)) {
    skipped.push(review.id ?? 'sans-id');
    continue;
  }
  registry.reviews.push(review);
  knownIds.add(review.id);
  knownTexts.add(textKey);
  imported.push(review.id);
}

await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(JSON.stringify({ imported: imported.length, skipped: skipped.length, ids: imported }, null, 2));
