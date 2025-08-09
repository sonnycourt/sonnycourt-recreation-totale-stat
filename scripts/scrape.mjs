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
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const images = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      console.log('Found', imgs.length, 'images');
      return Array.from(imgs).map(img => img.src).filter(src => src);
    });
    
    console.log('Images found:', images);
    
    fs.writeFileSync('images-list.json', JSON.stringify(images, null, 2));
    console.log('Images saved to images-list.json');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

scrapeImages();
