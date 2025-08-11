import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function scrapeImages() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Simuler un vrai navigateur
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('Navigating to the page...');
    await page.goto('https://sonnycourt.com/challenge-transformation', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    console.log('Page loaded, extracting images...');
    
    // Récupérer toutes les images
    const images = await page.evaluate(() => {
      const imgElements = document.querySelectorAll('img');
      return Array.from(imgElements).map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height
      })).filter(img => img.src && img.src.startsWith('http'));
    });
    
    console.log(`Found ${images.length} images:`);
    images.forEach((img, index) => {
      console.log(`${index + 1}. ${img.src} (${img.alt || 'no alt'})`);
    });
    
    // Sauvegarder la liste
    fs.writeFileSync('images-list.json', JSON.stringify(images, null, 2));
    console.log('Images list saved to images-list.json');
    
    return images;
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

scrapeImages();
