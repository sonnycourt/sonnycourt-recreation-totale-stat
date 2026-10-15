import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deltaImageWidths } from '../src/lib/delta-vision-images.mjs';
const media = fileURLToPath(new URL('../public/media/pages/', import.meta.url));
await mkdir(`${media}/delta-responsive`, { recursive: true });
for (const [name, widths] of Object.entries(deltaImageWidths)) {
  const input = `${media}/${name}.webp`;
  const original = await stat(input);
  for (const width of widths) {
    const output = `${media}/delta-responsive/${name}-${width}.webp`;
    await sharp(input).resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 100, effort: 6 }).toFile(output);
    const result = await stat(output);
    console.log(`${name} ${width}px: ${(result.size / 1024).toFixed(1)} KiB (original ${(original.size / 1024).toFixed(1)} KiB)`);
  }
}
