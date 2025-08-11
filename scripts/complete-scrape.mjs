import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeAllImages() {
  console.log('🚀 Starting complete image scraper...');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-web-security']
  });

  try {
    const page = await browser.newPage();
    console.log('📄 Page created');
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('🌐 Navigating to the page...');
    await page.goto('https://sonnycourt.com/challenge-transformation', { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });
    console.log('✅ Page loaded');
    
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    console.log('📜 Scrolling to load all images...');
    await page.evaluate(async () => {
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      const scrollStep = viewportHeight / 2;
      
      for (let i = 0; i < scrollHeight; i += scrollStep) {
        window.scrollTo(0, i);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔍 Extracting all images...');
    
    const allImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      const images = Array.from(imgs).map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height,
        className: img.className,
        dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original
      })).filter(img => img.src && img.src.startsWith('http'));
      
      // Chercher aussi les images cachées
      const hiddenImgs = document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]');
      const hiddenImages = Array.from(hiddenImgs).map(img => ({
        src: img.dataset.src || img.dataset.lazySrc || img.dataset.original,
        alt: img.alt,
        width: img.width,
        height: img.height,
        className: img.className,
        source: 'hidden'
      })).filter(img => img.src && img.src.startsWith('http'));
      
      return [...images, ...hiddenImages];
    });
    
    const uniqueImages = allImages.filter((img, index, self) => 
      index === self.findIndex(t => t.src === img.src)
    );
    
    console.log(`🎯 Total unique images found: ${uniqueImages.length}`);
    
    uniqueImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img.src} (${img.alt || 'no alt'}) - ${img.width}x${img.height}`);
    });
    
    fs.writeFileSync('all-images-complete.json', JSON.stringify(uniqueImages, null, 2));
    console.log('💾 Complete images list saved to all-images-complete.json');
    
    return uniqueImages;
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

scrapeAllImages();
