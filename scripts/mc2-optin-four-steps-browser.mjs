import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

// All API calls are intercepted: no registration, SMS, email or tracking write.
const base = process.env.OPTIN_TEST_URL || 'http://localhost:4382';
const browser = await puppeteer.launch({ headless: true });
try {
  for (const path of ['/mc2/', '/meta/mc2/']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    const requests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/.netlify/functions/')) {
        const data = JSON.parse(req.postData() || '{}');
        requests.push({ name: url.pathname.split('/').pop(), data });
        const body = url.pathname.includes('check-mc2-eligibility') || url.pathname.includes('check-mc2-phone-country')
          ? { eligible: true } : { ok: true, count: 12 };
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      // Exercise the native phone fallback; no requests to third-party services.
      if (url.origin !== new URL(base).origin) return req.abort();
      return req.continue();
    });
    await page.goto(base + path + '?preview=dev', { waitUntil: 'networkidle0' });
    await page.click('[data-mc2-picker="hero"] [data-slot-id="fixed-1"]').catch(async () => {
      await page.click('[data-slot-id="fixed-1"]');
    });
    await page.click('.popup-trigger');
    await page.waitForSelector('#name', { visible: true });
    await page.waitForFunction(() => !document.getElementById('pre-optin-overlay').classList.contains('is-visible'));
    assert.equal(await page.$eval('#custom-popup', el => el.querySelectorAll('[data-slot-id]').length), 0);
    await page.click('#name-next');
    assert.ok(await page.$eval('#name-message', el => el.textContent));
    await page.type('#name', 'Test');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#email', { visible: true });
    await page.type('#email', 'invalid');
    await page.click('#step1-button');
    assert.ok(await page.$eval('#step1-message', el => el.textContent));
    assert.equal(requests.filter(r => r.name === 'check-mc2-eligibility').length, 0);
    await page.$eval('#email', el => el.value = '');
    await page.type('#email', 'test@example.invalid');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#phone', { visible: true });
    await page.type('#phone', '+33612345678');
    await page.click('#step2-next');
    await page.waitForSelector('#commit-present', { visible: true });
    assert.equal(requests.filter(r => r.name === 'register-mc2').length, 0);
    assert.equal(requests.find(r => r.name === 'check-mc2-phone-country').data.prenom, 'Test');
    for (const event of ['name_completed', 'step_1_completed', 'step_2_completed']) {
      assert.ok(requests.some(r => r.data.event_name === event), event);
    }
    const phoneEvent = requests.find(r => r.data.event_name === 'step_2_completed');
    assert.ok(phoneEvent.data.session_date);
    assert.equal(phoneEvent.data.path, path);
    assert.equal(phoneEvent.data.traffic_source, path.startsWith('/meta/') ? 'meta_ad' : null);
    assert.deepEqual(errors, []);
    console.log(path, 'four steps, validation, phone fallback, country gate payload, attribution and tracking OK');
    await page.close();
  }
} finally {
  await browser.close();
}
