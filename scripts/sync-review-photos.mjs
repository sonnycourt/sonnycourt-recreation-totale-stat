import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const projectRoot = resolve(import.meta.dirname, '..');
const registryPath = resolve(projectRoot, 'src/data/reviews.json');
const publicRoot = resolve(projectRoot, 'public');
const { reviews } = JSON.parse(await readFile(registryPath, 'utf8'));

for (const review of reviews) {
  if (!review.source_photo_url || !review.photo) continue;

  const relativePath = review.photo.replace(/^\//, '');
  const destination = resolve(publicRoot, relativePath);
  if (!destination.startsWith(`${publicRoot}/`)) throw new Error(`Chemin photo invalide : ${review.photo}`);

  await mkdir(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    console.log(`Déjà présente : ${relativePath}`);
    continue;
  }

  const response = await fetch(review.source_photo_url);
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}) : ${review.first_name}`);

  await sharp(Buffer.from(await response.arrayBuffer()))
    .rotate()
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(destination);

  console.log(`Importée : ${relativePath}`);
}
