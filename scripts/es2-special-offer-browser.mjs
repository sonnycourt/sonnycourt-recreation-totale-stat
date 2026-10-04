import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const base = process.env.SPECIAL_OFFER_TEST_URL || 'http://127.0.0.1:4391';
const browser = await puppeteer.launch({ headless: true });
const errors = [], unexpectedWrites = [], providerRequests = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      if (url.origin === base) unexpectedWrites.push(request.url());
      return request.abort();
    }
    if (url.hostname.includes('spiffy') || url.pathname.startsWith('/.netlify/')) { providerRequests.push(request.url()); return request.abort(); }
    return request.continue();
  });
  for (const viewport of [{width:1440,height:1000}, {width:768,height:1024}, {width:390,height:844}, {width:320,height:700}, {width:844,height:390}]) {
    await page.setViewport(viewport);
    await page.goto(`${base}/es2-offre-speciale/?preview=dev`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-checkout-ready="true"]');
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, mainVisible: getComputedStyle(document.querySelector('#deal-offer-content')).display !== 'none', clocks: [...document.querySelectorAll('[data-special-clock]')].map(x=>x.textContent.trim()), buttonsEnabled: !document.querySelector('.special-hero__cta').disabled }));
    assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify({ viewport, layout }));
    assert.ok(layout.mainVisible && layout.buttonsEnabled);
    assert.equal(layout.clocks.length, 2);
    assert.equal(layout.clocks[0], layout.clocks[1]);
    await page.screenshot({ path: `/private/tmp/es2-special-${viewport.width}.png` });
    await page.click('.special-hero__cta');
    await page.waitForSelector('dialog[open]');
    await page.type('#draftx-first-name', 'Aperçu');
    await page.type('#draftx-email', 'apercu@example.invalid');
    await page.click('[data-checkout-step="1"] button[type="submit"]');
    await page.waitForSelector('[data-checkout-step="2"]:not([hidden])');
    await page.waitForFunction(() => document.querySelector('[data-checkout-step="2"]').getAnimations().every(animation => animation.playState === 'finished'));
    await page.click('[data-payment-plan="twelve"]');
    await page.screenshot({ path: `/private/tmp/es2-special-checkout-${viewport.width}.png` });
    const modal = await page.$eval('dialog[open]', node => { const box=node.getBoundingClientRect(); return { left:box.left, right:box.right, scrollWidth:node.scrollWidth, clientWidth:node.clientWidth }; });
    assert.ok(modal.left >= 0 && modal.right <= viewport.width + 1 && modal.scrollWidth <= modal.clientWidth + 1, JSON.stringify(modal));
    await page.click('[data-checkout-step="2"] button[type="submit"]');
    assert.match(await page.$eval('[data-spiffy-slot]', node=>node.textContent), /aucun débit possible/);
    assert.match(await page.$eval('[data-payment-charge]', node=>node.textContent), /197/);
    await page.click('[data-checkout-close]');
    await page.$eval('#preview-open-reviews', node=>node.click());
    assert.ok(await page.$('#preview-reviews-dialog[open]'));
    await page.click('#preview-close-reviews');
    for (const selector of ['.core-daily-plan', '#two-paths-registration-cta', '#deal-sticky-cta']) {
      await page.$eval(selector, node=>node.click());
      assert.ok(await page.$('dialog[open]'));
      await page.click('[data-checkout-close]');
    }
    console.log(`PASS viewport ${viewport.width}x${viewport.height}: visible offer, shared clocks, CTA, steps 1–3, no overflow.`);
  }
  for (const phase of ['upcoming', 'expired', 'full']) {
    await page.goto(`${base}/es2-offre-speciale/?preview=dev&phase=${phase}`, { waitUntil:'domcontentloaded' });
    await page.waitForSelector('[data-checkout-ready="true"]');
    assert.ok(await page.$eval('.special-hero__cta', n=>n.disabled));
    assert.ok(await page.$eval('#deal-offer-content', n=>getComputedStyle(n).display !== 'none'));
    console.log(`PASS ${phase}: offer readable, purchase unavailable.`);
  }
  await page.goto(`${base}/es2-offre-speciale/`, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('[data-checkout-ready="true"]');
  assert.ok(await page.$eval('.special-hero__cta', n=>n.disabled));
  assert.match(await page.$eval('[data-campaign-status]', n=>n.textContent), /confirmer/);
  assert.deepEqual(unexpectedWrites, []);
  assert.deepEqual(providerRequests, []);
  assert.deepEqual(errors, []);
  console.log('PASS draft protection: no provider, backend writes or JavaScript errors.');
} finally { await browser.close(); }
