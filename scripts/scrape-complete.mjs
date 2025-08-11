import puppeteer from 'puppeteer';
import fs from 'fs';

async function scrapeAllImages() {
  console.log('🚀 Starting complete image scraper...');
  
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-web-security', '--disable-features=VizDisplayCompositor']
  });

  try {
    const page = await browser.newPage();
    console.log('📄 Page created');
    
    // Simuler un vrai navigateur
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('🌐 Navigating to the page...');
    await page.goto('https://sonnycourt.com/challenge-transformation', { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });
    console.log('✅ Page loaded');
    
    // Attendre que tout soit chargé
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Scroll progressif pour déclencher le lazy loading
    console.log('📜 Scrolling to load all images...');
    await page.evaluate(async () => {
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      const scrollStep = viewportHeight / 2;
      
      for (let i = 0; i < scrollHeight; i += scrollStep) {
        window.scrollTo(0, i);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Remonter en haut
      window.scrollTo(0, 0);
      await new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    // Attendre encore un peu
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔍 Extracting all images...');
    
    // Récupérer toutes les images de la page principale
    const mainImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      return Array.from(imgs).map(img => ({
        src: img.src,
        alt: img.alt,
        width: img.width,
        height: img.height,
        className: img.className,
        id: img.id,
        dataSrc: img.dataset.src || img.dataset.lazySrc || img.dataset.original
      })).filter(img => img.src && img.src.startsWith('http'));
    });
    
    console.log(`📸 Found ${mainImages.length} images in main page`);
    
    // Récupérer les images des iframes (Elfsight widgets)
    const iframeImages = await page.evaluate(async () => {
      const iframes = document.querySelectorAll('iframe');
      const allImages = [];
      
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
          const imgs = iframeDoc.querySelectorAll('img');
          
          Array.from(imgs).forEach(img => {
            if (img.src && img.src.startsWith('http')) {
              allImages.push({
                src: img.src,
                alt: img.alt,
                width: img.width,
                height: img.height,
                className: img.className,
                source: 'iframe'
              });
            }
          });
        } catch (e) {
          // Iframe inaccessible (CORS)
        }
      }
      
      return allImages;
    });
    
    console.log(`📸 Found ${iframeImages.length} images in iframes`);
    
    // Récupérer les images cachées (lazy loading)
    const hiddenImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[data-src], img[data-lazy-src], img[data-original]');
      return Array.from(imgs).map(img => ({
        src: img.dataset.src || img.dataset.lazySrc || img.dataset.original,
        alt: img.alt,
        width: img.width,
        height: img.height,
        className: img.className,
        source: 'hidden'
      })).filter(img => img.src && img.src.startsWith('http'));
    });
    
    console.log(`📸 Found ${hiddenImages.length} hidden images`);
    
    // Combiner toutes les images
    const allImages = [...mainImages, ...iframeImages, ...hiddenImages];
    
    // Supprimer les doublons
    const uniqueImages = allImages.filter((img, index, self) => 
      index === self.findIndex(t => t.src === img.src)
    );
    
    console.log(`🎯 Total unique images found: ${uniqueImages.length}`);
    
    // Afficher toutes les images
    uniqueImages.forEach((img, index) => {
      console.log(`${index + 1}. ${img.src} (${img.alt || 'no alt'}) - ${img.width}x${img.height} - ${img.source || 'main'}`);
    });
    
    // Sauvegarder la liste complète
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
