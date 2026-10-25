import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { deltaVisionReviews } from '../src/data/delta-vision-reviews.mjs';

const output = new URL('../public/media/delta-reviews/', import.meta.url);
await mkdir(output, { recursive: true });
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const normalize = (s) => s.replace(/\s+/gu, ' ').trim();
const sizes = {};
for (const review of deltaVisionReviews) {
  const lines = [];
  for (const [index, paragraph] of review.text.split('\n\n').entries()) {
    if (index) lines.push('');
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      const { width } = await sharp({ text: { text: escape(candidate), font: 'Arial 20', dpi: 72 } }).metadata();
      // Leave extra space for platform font rendering differences.
      if (width > 330 && line) { lines.push(line); line = word; }
      else line = candidate;
    }
    if (line) lines.push(line);
  }
  assert.equal(normalize(lines.join(' ')), normalize(review.text));
  const height = 118 + lines.length * 29;
  sizes[review.id] = { width: 400, height };
  const stars = Array.from({ length: review.rating }, (_, i) => `<path transform="translate(${254 + i * 23} 36) scale(.7)" d="m12 0 3.7 7.5 8.3 1.2-6 5.8 1.4 8.3-7.4-3.9-7.4 3.9L6 14.5 0 8.7l8.3-1.2Z" fill="#ad643a"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${height}" viewBox="0 0 400 ${height}">
<title>${escape(review.name)} — ${review.rating}/5</title>
<desc>${escape(review.text)}</desc>
<rect x=".5" y=".5" width="399" height="${height - 1}" rx="20" fill="#fffcf7" stroke="#e4d9c8"/>
<text x="28" y="52" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#353a30">${escape(review.name)}</text>
${stars}
<path d="M28 74H372" stroke="#e9e0d4"/>
<text font-family="Arial, 'Apple Color Emoji', sans-serif" font-size="20" fill="#3c3b34">${lines.map((line, index) => `<tspan x="28" y="${111 + index * 29}">${escape(line)}</tspan>`).join('')}</text>
</svg>\n`;
  await writeFile(new URL(`${review.id}.svg`, output), svg);
  console.log(`${review.id}: ${lines.length} lines, ${Buffer.byteLength(svg)} bytes`);
}
await writeFile(new URL('../src/data/delta-vision-review-sizes.json', import.meta.url), JSON.stringify(sizes, null, 2) + '\n');
console.log(`Images generated in ${fileURLToPath(output)}; all review text checked verbatim.`);
