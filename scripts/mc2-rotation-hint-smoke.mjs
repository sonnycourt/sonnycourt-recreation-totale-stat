import assert from 'node:assert/strict';
import puppeteer, { KnownDevices } from 'puppeteer';

// Real page/CSS, read-only UI tests; no media or business-service calls.
const base = process.env.MC2_TEST_BASE || 'http://127.0.0.1:4392';
const browser = await puppeteer.launch({headless:true});
try {
  const cases = [
    {name:'iPhone portrait', device:'iPhone 13', expected:true},
    {name:'iPhone landscape', device:'iPhone 13 landscape', expected:false},
    {name:'Android phone', device:'Pixel 5', expected:true},
    {name:'iPad portrait', device:'iPad Pro 11', expected:false},
    {name:'iPad mini portrait', device:'iPad Mini', expected:false},
    {name:'iPad narrow split view', device:'iPad Pro 11', width:390, height:1024, expected:false},
    {name:'Android tablet', device:'Galaxy Tab S4', expected:false},
    {name:'Narrow desktop window', width:390, height:844, expected:false},
    {name:'Desktop', width:1440, height:1000, expected:false},
  ];
  for (const test of cases) {
    const page = await browser.newPage();
    if (test.device) {
      assert.ok(KnownDevices[test.device], test.device);
      await page.emulate(KnownDevices[test.device]);
    }
    if (test.width) await page.setViewport({width:test.width, height:test.height, isMobile:!!test.device, hasTouch:!!test.device});
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' || url.origin !== new URL(base).origin || url.pathname.startsWith('/.netlify/')) return request.abort();
      return request.continue();
    });
    await page.goto(`${base}/mc2/session/?preview=dev&state=session-p2`, {waitUntil:'domcontentloaded'});
    await page.waitForSelector('#rotate-hint');
    const visible = await page.$eval('#rotate-hint', e => getComputedStyle(e).display !== 'none');
    assert.equal(visible, test.expected, test.name);
    console.log(`PASS — ${test.name}: rotation hint ${visible ? 'shown' : 'hidden'}`);
    await page.close();
  }
} finally { await browser.close(); }
