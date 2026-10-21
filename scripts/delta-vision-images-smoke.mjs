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
    assert((await stat(path)).size <= originalSize, 'Never enlarge an already optimized original');
  }
}
assert.deepEqual(responsiveDeltaImage('/unknown.webp', posterSizes), {}, 'Unknown future poster keeps its original source');
const html = await readFile(new URL('dist/delta-vision/index.html', root), 'utf8');
const poster = html.match(/<img[^>]*class="video-thumbnail"[^>]*>/)?.[0];
assert(poster?.includes('srcset=') && poster.includes('fetchpriority="high"'));
assert(!poster.includes('loading="lazy"'), 'Never defer the LCP image');
assert.equal((html.match(/<img[^>]*\ssrcset=/g) || []).length, 13);
const art = html.match(/<img[^>]*alt="Sonny en méditation[^>]*>/)?.[0];
const preload = html.match(/<link[^>]*imagesrcset=[^>]*>/)?.[0];
assert(art?.includes('delta-vision-checkout-foliage-v1-640.webp'));
assert(preload?.includes('media="(min-width: 761px)"'), 'Do not preload hidden art on mobile');
assert(preload.includes('fetchpriority="low"'), 'Keep the main poster priority');
assert.equal(preload.match(/imagesrcset="([^"]+)"/)[1], art.match(/srcset="([^"]+)"/)[1]);
assert.equal(preload.match(/imagesizes="([^"]+)"/)[1], art.match(/sizes="([^"]+)"/)[1]);
assert(html.includes('/delta-responsive/delta-jungle-canopy-v1-480.webp'));
for (const route of ['delta-vision-cadeau', 'mc2']) {
  const other = await readFile(new URL(`dist/${route}/index.html`, root), 'utf8');
  assert(!other.includes('/delta-responsive/'), 'Keep other pages unchanged');
}
console.log('PASS: responsive WebP images, transparency, poster priority, desktop-only popup preload and page isolation.');
