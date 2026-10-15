import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { deltaImageWidths, responsiveDeltaImage, posterSizes } from '../src/lib/delta-vision-images.mjs';
const root = new URL('../', import.meta.url);
for (const [name, widths] of Object.entries(deltaImageWidths)) {
  const original = new URL(`public/media/pages/${name}.webp`, root);
  const originalMeta = await sharp(await readFile(original)).metadata();
  const originalSize = (await stat(original)).size;
  for (const width of widths) {
    const path = new URL(`public/media/pages/delta-responsive/${name}-${width}.webp`, root);
    const meta = await sharp(await readFile(path)).metadata();
    assert.equal(meta.width, width);
    assert.equal(Boolean(meta.hasAlpha), Boolean(originalMeta.hasAlpha), 'Preserve foliage transparency');
    assert(Math.abs(meta.height - width * originalMeta.height / originalMeta.width) <= 1, 'Preserve aspect ratio');
    assert((await stat(path)).size < originalSize, 'Each variant must be smaller than the original');
  }
}
assert.deepEqual(responsiveDeltaImage('/unknown.webp', posterSizes), {}, 'Unknown future poster keeps its original source');
const html = await readFile(new URL('dist/delta-vision/index.html', root), 'utf8');
const poster = html.match(/<img[^>]*class="video-thumbnail"[^>]*>/)?.[0];
assert(poster?.includes('srcset=') && poster.includes('fetchpriority="high"'));
assert(!poster.includes('loading="lazy"'), 'Never defer the LCP image');
assert.equal((html.match(/srcset=/g) || []).length, 12);
for (const route of ['delta-vision-cadeau', 'mc2']) {
  const other = await readFile(new URL(`dist/${route}/index.html`, root), 'utf8');
  assert(!other.includes('/delta-responsive/'), 'Keep other pages unchanged');
}
console.log('PASS: 20 smaller images, dimensions, transparency, responsive poster priority, all 12 images and isolation from other pages.');
