import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

// Browser integration of the real gate/offer code. Every network request is
// intercepted; fixture addresses never reach production or an email provider.
const gate = readFileSync(new URL('../src/components/Mc2AccessGate.astro', import.meta.url), 'utf8')
  .replace(/^---[\s\S]*?---/, '').replace('<style is:global>', '<style>');
const offer = readFileSync(new URL('../src/pages/offre/index.astro', import.meta.url), 'utf8')
  .replace(/^---[\s\S]*?---/, '');
const browser = await puppeteer.launch({ headless: true });
try {
  for (const path of ['/mc2/session/', '/mc2/confirmation/', '/commencer/', '/offre/']) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 390, height: 844 });
    await page.setRequestInterception(true);
    const calls = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', async (request) => {
      const url = new URL(request.url());
      calls.push({ host: url.hostname, path: url.pathname, method: request.method() });
      if (url.hostname !== 'mc2-access.test') { await request.abort(); return; }
      if (url.pathname === '/.netlify/functions/request-mc2-access') {
        const { email } = JSON.parse(request.postData());
        await request.respond({ status: email === 'fixture@example.com' ? 200 : 404, contentType: 'application/json',
          body: JSON.stringify(email === 'fixture@example.com' ? { ok: true, token: 'fixture-token' } : { error: 'Aucune inscription trouvée avec cet email.' }),
        });
        return;
      }
      if (url.pathname === '/.netlify/functions/get-mc2-registration') {
        await request.respond({ status: 200, contentType: 'application/json', body: '{"valid":true}' });
        return;
      }
      if (request.resourceType() !== 'document') { await request.abort(); return; }
      if (path === '/offre/' && url.pathname === '/mc2/session/') {
        await request.respond({ status: 200, contentType: 'text/html', body: '<h1>Session fixture</h1>' });
        return;
      }
      assert.equal(url.pathname, path);
      const html = path === '/offre/' ? offer : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
        + gate.replace('data-page-path={pagePath}', `data-page-path="${path}"`)
        + '<p id="access-ready" hidden>Accès ouvert</p><script>window.__MC2_ACCESS__.resolve().then(() => document.getElementById("access-ready").hidden = false);</script></body></html>';
      await request.respond({ status: 200, contentType: 'text/html', body: html });
    });
    await page.goto(`https://mc2-access.test${path}`, { waitUntil: 'domcontentloaded' });
    const input = path === '/offre/' ? '#offer-email' : '#mc2-access-email';
    const button = path === '/offre/' ? '#offer-submit' : '#mc2-access-submit';
    const error = path === '/offre/' ? '#offer-error' : '#mc2-access-error';
    await page.waitForSelector(input, { visible: true });
    await page.type(input, 'unknown@example.com');
    await page.click(button);
    await page.waitForFunction((selector) => document.querySelector(selector).textContent.includes('Aucune inscription'), {}, error);
    await page.click(input, { clickCount: 3 });
    await page.type(input, 'fixture@example.com');
    await page.click(button);
    if (path === '/offre/') {
      await page.waitForFunction(() => location.pathname === '/mc2/session/');
    } else {
      await page.waitForSelector('#access-ready', { visible: true });
      assert.equal(await page.$eval('#mc2-access-gate', (el) => el.hidden), true);
      assert.equal(await page.$eval('html', (el) => el.classList.contains('mc2-access-locked')), false);
    }
    const result = new URL(page.url());
    assert.equal(result.searchParams.get('t'), 'fixture-token');
    assert.equal(result.pathname, path === '/offre/' ? '/mc2/session/' : path);
    assert.equal(await page.evaluate(() => localStorage.getItem('mc2_registration_token')), 'fixture-token');
    assert.equal(calls.filter((call) => call.method === 'POST').length, 2);
    assert.ok(calls.every((call) => call.method !== 'POST' || call.path === '/.netlify/functions/request-mc2-access'));
    assert.deepEqual(errors, []);
    console.log(`${path}: mobile form, unknown email retry, immediate access, URL/storage OK (mocked requests only)`);
    await context.close();
  }
} finally {
  await browser.close();
}
