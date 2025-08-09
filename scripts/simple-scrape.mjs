import puppeteer from 'puppeteer';

async function scrapeImages() {
  console.log('Starting scraper...');
  
  const browser = await puppeteer.launch({
    headless: false, // Pour voir ce qui se passe
    args: ['--no-sandbox']
  });

  try {
    console.log('Browser launched');
    const page = await browser.newPage();
    console.log('Page created');
    
    console.log('Navigating to the page...');
    await page.goto('https://sonnycourt.com/challenge-transformation');
    console.log('Page loaded');
    
    // Attendre un peu
    await page.waitForTimeout(5000);
    
    const images = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      console.log('Found', imgs.length, 'images');
      return Array.from(imgs).map(img => img.src).filter(src => src);
    });
    
    console.log('Images found:', images);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

scrapeImages();
