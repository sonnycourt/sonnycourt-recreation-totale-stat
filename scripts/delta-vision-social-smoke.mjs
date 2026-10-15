import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import sharp from 'sharp';

const html = readFileSync('dist/delta-vision/index.html', 'utf8');
const image = 'public/media/pages/delta-vision-social-v1.jpg';
const metadata = await sharp(image).metadata();
assert.equal(metadata.width, 1200);
assert.equal(metadata.height, 630);
assert.equal(metadata.format, 'jpeg');
assert(statSync(image).size < 300000, 'Keep the sharing image lightweight');
const expected = {
  'og:title': 'Delta Vision — Respire. Visualise. Manifeste.',
  'og:type': 'website',
  'og:url': 'https://sonnycourt.com/delta-vision/',
  'og:image': 'https://sonnycourt.com/media/pages/delta-vision-social-v1.jpg',
  'og:image:type': 'image/jpeg',
  'og:image:width': '1200',
  'og:image:height': '630',
  'twitter:card': 'summary_large_image',
  'twitter:image': 'https://sonnycourt.com/media/pages/delta-vision-social-v1.jpg',
};
for (const [key, value] of Object.entries(expected)) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/g)].map(m => m[0]).filter(t => t.includes(`="${key}"`));
  assert.equal(tags.length, 1, `Exactly one ${key}`);
  assert(tags[0].includes(`content="${value}"`), `${key} value`);
}
assert(html.includes('property="og:image:alt"'));
assert(!readFileSync('public/robots.txt','utf8').includes('Disallow: /media'));
console.log('PASS: social tags rendered server-side, unique, absolute URL; 1200×630 JPEG under 300 kB.');
