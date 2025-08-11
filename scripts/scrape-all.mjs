import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeImages() {
  console.log('Starting scraper...');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox']
  });

  try {
    console.log('Browser launched');
    const page = await browser.newPage();
    console.log('Page created');
    
    console.log('Navigating to the page...');
    await page.goto('https://sonnycourt.com/challenge-transformation');
    console.log('Page loaded');
    
    // Attendre que la page soit complètement chargée
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Scroll pour charger toutes les images lazy
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const images = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      console.log('Found', imgs.length, 'images');
      return Array.from(imgs).map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height,
        className: img.className
      })).filter(img => img.src && img.src.startsWith('http'));
    });
    
    console.log('Images found:', images.length);
    images.forEach((img, index) => {
      console.log(`${index + 1}. ${img.src} (${img.alt || 'no alt'}) - ${img.width}x${img.height}`);
    });
    
    fs.writeFileSync('all-images.json', JSON.stringify(images, null, 2));
    console.log('Images saved to all-images.json');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

scrapeImages();
