import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

// All API calls are intercepted: no registration, SMS, email or tracking write.
const publicBuild = process.env.OPTIN_TEST_PUBLIC === '1';
const base = publicBuild ? 'https://mc2-optin.test' : (process.env.OPTIN_TEST_URL || 'http://localhost:4382');
const buildRoot = new URL('../dist/', import.meta.url).pathname;
const browser = await puppeteer.launch({ headless: true });
try {
  const scenarios = ['/mc2/', '/meta/mc2/'].flatMap(path => (publicBuild ? [390, 1365] : [390]).map(width => ({ path, width })));
  for (const { path: route, width } of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 844 });
    const requests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { console.log('Dialog:', dialog.message()); await dialog.dismiss(); });
    await page.setRequestInterception(true);
    await page.evaluateOnNewDocument(() => { window.__browserTestFetch = window.fetch.bind(window); });
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.hostname === 'ipapi.co') return req.respond({ status: 200, contentType: 'application/json', body: '{"country_code":"FR"}' });
      if (url.pathname.startsWith('/.netlify/functions/')) {
        const data = JSON.parse(req.postData() || '{}');
        requests.push({ name: url.pathname.split('/').pop(), data });
        const body = url.pathname.includes('register-mc2')
          ? { success: true, token: 'mc2-preview', entryPaymentRequired: false }
          : url.pathname.includes('check-mc2-eligibility') || url.pathname.includes('check-mc2-phone-country')
          ? { eligible: true } : { ok: true, count: 12 };
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      // Allow only the phone widget's static assets; no external data writes.
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('intl-tel-input@18.5.3/')) return req.continue();
      if (url.origin !== new URL(base).origin) return req.abort();
      if (publicBuild) {
        let filename = path.resolve(buildRoot, '.' + url.pathname);
        if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
        if (!filename.startsWith(buildRoot) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return req.respond({ status: 404, body: '' });
        const type = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
        return req.respond({ status: 200, contentType: type, body: fs.readFileSync(filename) });
      }
      return req.continue();
    });
    await page.goto(base + route + (publicBuild ? '' : '?preview=dev'), { waitUntil: 'networkidle0' });
    if (publicBuild) {
      assert.equal(await page.evaluate(() => window.__MC2_PREVIEW_ONLY__), false, 'No preview simulator on the public path');
      assert.equal(await page.$eval('html', el => el.dataset.mc2PublicClosed), 'false');
      await page.waitForSelector('#page-main.is-visible', { visible: true });
    }
    // Bypass only the local fetch simulator; requests still hit our mocks above.
    await page.evaluate(() => { window.fetch = window.__browserTestFetch; });
    await page.click('[data-mc2-picker="hero"] [data-slot-id="fixed-1"]').catch(async () => {
      await page.click('[data-slot-id="fixed-1"]');
    });
    await page.click('.popup-trigger');
    await page.waitForSelector('#name', { visible: true });
    await page.waitForFunction(() => !document.getElementById('pre-optin-overlay').classList.contains('is-visible'));
    await page.screenshot({ path: '/private/tmp/mc2-optin-name-' + (route.startsWith('/meta/') ? 'meta' : 'organic') + '-' + width + '.png' });
    assert.equal(await page.$eval('#custom-popup', el => el.querySelectorAll('[data-slot-id]').length), 3);
    assert.equal(await page.$eval('[data-mc2-picker="popup"] .is-selected', el => el.dataset.slotId), 'fixed-1');
    await page.click('[data-mc2-picker="popup"] [data-slot-id="fixed-2"]');
    assert.equal(await page.$eval('[data-mc2-picker="hero"] .is-selected', el => el.dataset.slotId), 'fixed-2');
    await page.waitForSelector('#email', { visible: true });
    await page.click('#step1-button');
    assert.ok(await page.$eval('#step1-message', el => el.textContent));
    await page.type('#name', 'Test');
    await page.waitForSelector('#email', { visible: true });
    await page.type('#email', 'invalid');
    await page.click('#step1-button');
    assert.ok(await page.$eval('#step1-message', el => el.textContent));
    assert.equal(requests.filter(r => r.name === 'check-mc2-eligibility').length, 0);
    await page.$eval('#email', el => el.value = '');
    await page.type('#email', 'test@example.invalid');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#phone', { visible: true }).catch(async error => {
      console.log(await page.$eval('#custom-popup', el => el.innerText), requests, errors);
      throw error;
    });
    await page.waitForFunction(() => !document.getElementById('step2-next').disabled && Boolean(window.intlTelInputUtils));
    await page.$eval('#phone', el => el.value = '');
    await page.type('#phone', '612345678');
    await page.click('#step2-next');
    await page.waitForSelector('#commit-present', { visible: true });
    const captures = requests.filter(r => r.name === 'register-mc2');
    assert.equal(captures.length, 1);
    assert.equal(captures[0].data.email, 'test@example.invalid');
    assert.equal(captures[0].data.prenom, 'Test');
    assert.equal(captures[0].data.creneau, 'fixed-2');
    assert.equal(captures[0].data.telephone, undefined);
    assert.equal(requests.find(r => r.name === 'check-mc2-phone-country').data.prenom, 'Test');
    for (const event of ['step_1_completed', 'step_2_completed']) {
      assert.ok(requests.some(r => r.data.event_name === event), event);
    }
    const phoneEvent = requests.find(r => r.data.event_name === 'step_2_completed');
    assert.ok(phoneEvent.data.session_date);
    assert.equal(phoneEvent.data.path, route);
    assert.equal(phoneEvent.data.traffic_source, route.startsWith('/meta/') ? 'meta_ad' : null);
    await page.click('#step3-submit');
    assert.ok(await page.$eval('#step3-message', el => el.textContent));
    assert.equal(requests.filter(r => r.name === 'register-mc2').length, 1, 'No full registration without commitment');
    await page.click('#commit-present');
    await Promise.all([page.waitForNavigation(), page.click('#step3-submit')]);
    const full = requests.filter(r => r.name === 'register-mc2');
    assert.equal(full.length, 2);
    assert.equal(full[1].data.email, 'test@example.invalid');
    assert.equal(full[1].data.prenom, 'Test');
    assert.ok(full[1].data.telephone);
    assert.equal(full[1].data.creneau, captures[0].data.creneau);
    assert.equal(full[1].data.optin_funnel_id, captures[0].data.optin_funnel_id);
    assert.equal(new URL(page.url()).pathname.replace(/\/$/, ''), '/mc2/confirmation', 'Confirmation navigation: ' + page.url());
    assert.equal(new URL(page.url()).searchParams.get('t'), 'mc2-preview');
    assert.deepEqual(errors, []);
    console.log(route, width, publicBuild ? 'PUBLIC (no preview)' : 'preview', 'three steps, partial capture, commitment gate, full registration and token redirect OK');
    await page.close();
  }
} finally {
  await browser.close();
}
