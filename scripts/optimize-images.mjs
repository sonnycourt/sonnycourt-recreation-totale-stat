import sharp from 'sharp';
import { readdir } from 'fs/promises';
import path from 'path';

const FORMATIONS_DIR = '../public/images/formations';

async function optimizeImages() {
  try {
    const files = await readdir(FORMATIONS_DIR);
    const imageFiles = files.filter(file => 
      !file.startsWith('.') && 
      !file.includes('backup') &&
      (file.endsWith('.png') || file.endsWith('.webp'))
    );

    for (const file of imageFiles) {
      const inputPath = path.join(FORMATIONS_DIR, file);
      const outputPath = path.join(FORMATIONS_DIR, file.replace('.png', '.webp'));
      
      await sharp(inputPath)
        .webp({ 
          quality: 85,
          effort: 6,
          smartSubsample: true,
          nearLossless: true
        })
        .resize({
          width: 1200,
          height: 800,
          fit: 'inside',
          withoutEnlargement: true
        })
        .toFile(outputPath);
      
      console.log(`Optimized: ${file} -> ${path.basename(outputPath)}`);
    }
  } catch (error) {
    console.error('Error optimizing images:', error);
  }
}

optimizeImages();
