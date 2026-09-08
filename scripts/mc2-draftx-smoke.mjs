import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('src/pages/mc2/draftx.astro');
const offer = read('src/components/mc2/DealOfferDraftX.astro');
const sandbox = read('src/components/mc2/DraftXSandbox.astro');
const untouched = [
  'src/pages/mc2/session.astro', 'src/pages/mc2/replay.astro',
  'src/components/mc2/DealOffer.astro', 'src/lib/mc2-timing.mjs',
  'src/lib/scarcity-engine.ts', 'src/lib/mc2-offer-observability.js',
  'src/data/mc2-offer-timeline.ts', 'src/data/scarcity-timeline.ts',
  'astro.config.mjs', 'netlify.toml', 'package.json',
];
for (const file of untouched) {
  const baseline = execFileSync('git', ['show', `17f353a:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(read(file), baseline, `Production file changed: ${file}`);
}
for (const file of ['src/lib/mc2-timing.mjs', 'src/lib/scarcity-engine.ts', 'src/lib/mc2-offer-observability.js', 'src/data/mc2-offer-timeline.ts', 'src/data/scarcity-timeline.ts']) {
  const draft = file.replace(/\/([^/]+)$/, (_, name) => '/mc2-draftx-' + name.replace(/^mc2-/, ''));
  assert.equal(read(draft).replaceAll('mc2-draftx-scarcity-timeline', 'scarcity-timeline').trim(), read(file).trim(), `Logic mismatch: ${file}`);
}
assert.match(source, /DealOfferDraftX\.astro/);
assert.match(source, /DraftXSandbox/);
assert.doesNotMatch(source, /<Mc2AccessGate|GAConsentMode|connect\.facebook\.net|clarity\.ms|\blocalStorage\.|\bsessionStorage\./);
assert.doesNotMatch(offer, /https:\/\/.*spiffy|createElement\('iframe'\)/);
assert.match(sandbox, /frame-src 'none'/);
assert.match(sandbox, /form-action 'none'/);

const base = process.argv[2] || 'http://127.0.0.1:4341';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Tests are local only.');
const browser = await puppeteer.launch({ headless: true });
const requests = [];
const errors = [];
const cases = [];
try {
  const page = await browser.newPage();
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('mc2_registration_token', 'untouched-test-sentinel');
    sessionStorage.setItem('es2_mc_dev_clock', 'untouched-clock-sentinel');
  });
  const response = await page.goto(base + '/mc2/draftx/?t=must-not-be-consumed&checkout=live&access=must-not-be-consumed', { waitUntil: 'networkidle2' });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.querySelector('#offer-zone')?.classList.contains('visible'));
  assert.equal(new URL(page.url()).searchParams.get('t'), null);
  assert.equal(new URL(page.url()).searchParams.get('access'), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('mc2_registration_token')), 'untouched-test-sentinel');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('es2_mc_dev_clock')), 'untouched-clock-sentinel');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('deal-sticky-cta')).position), 'fixed');
  await page.waitForFunction(() => document.querySelector('#masterclass-video')?.readyState >= 1);
  cases.push('desktop_load_video_cta_sticky_and_token_isolation');
  await page.screenshot({ path: '/private/tmp/mc2-draftx-desktop.png' });

  await page.click('#deal-sticky-cta');
  await page.click('[data-payment-plan="three"]');
  assert.equal(await page.$eval('[data-payment-plan="three"]', el => el.getAttribute('aria-pressed')), 'true');
  assert.match(await page.$eval('#draftx-payment-status', el => el.textContent), /3 mensualités/);
  await page.click('[data-payment-plan="once"]');
  await page.click('.draftx-checkout__pay');
  assert.match(await page.$eval('#draftx-payment-status', el => el.textContent), /aucun paiement/);
  assert.equal(await page.$$eval('iframe, spiffy-checkout', elements => elements.length), 0);
  await page.$eval('.deal-summary', el => el.scrollIntoView());
  await page.screenshot({ path: '/private/tmp/mc2-draftx-checkout-desktop.png' });
  cases.push('plan_selection_and_non_paying_checkout');

  await page.click('#preview-open-reviews');
  assert.equal(await page.$eval('#preview-reviews-dialog', el => el.open), true);
  await page.click('#preview-close-reviews');
  cases.push('reviews_dialog');

  await page.click('#dev-time-toggle');
  await page.click('[data-now-preset="cta-m10s"]');
  await page.waitForFunction(() => document.querySelector('#offer-zone')?.classList.contains('hidden'));
  await page.click('[data-now-preset="cta-active"]');
  await page.waitForFunction(() => document.querySelector('#offer-zone')?.classList.contains('visible'));
  cases.push('cta_hidden_before_013451_and_visible_at_cta');

  await page.click('[data-now-preset="scarcity-p24h"]');
  assert.equal(await page.$eval('.deal-scarcity__places strong span', el => el.textContent), '20');
  await page.click('[data-now-preset="scarcity-p48h"]');
  assert.equal(await page.$eval('.deal-scarcity__places strong span', el => el.textContent), '5');
  await page.click('[data-now-preset="expired"]');
  assert.equal(await page.$eval('#deal-offer-content', el => el.classList.contains('hidden')), true);
  cases.push('countdown_places_24h_48h_and_expiration');

  await page.click('[data-now-preset="webinaire-ended"]');
  await page.waitForFunction(() => document.body.innerText.includes('ta transformation commence maintenant'));
  cases.push('end_of_video_offer');

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.goto(base + '/mc2/draftx/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('#offer-zone')?.classList.contains('visible'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.screenshot({ path: '/private/tmp/mc2-draftx-mobile.png' });
  await page.$eval('.deal-summary', el => el.scrollIntoView());
  await page.screenshot({ path: '/private/tmp/mc2-draftx-checkout-mobile.png' });
  await page.click('[data-payment-plan="three"]');
  assert.equal(await page.$eval('[data-payment-plan="three"]', el => el.getAttribute('aria-pressed')), 'true');
  cases.push('mobile_layout_and_checkout');

  // Exercise the protection explicitly: no API request may leave the browser.
  const before = requests.length;
  await page.evaluate(() => fetch('/.netlify/functions/mc2-presence', { method: 'POST', body: '{}' }));
  assert.ok(requests.slice(before).every(r => !r.url.includes('/.netlify/')));
  assert.ok(requests.every(r => !r.url.includes('/.netlify/') && !/spiffy|facebook|clarity\.ms|google-analytics/.test(r.url)), 'Production network call detected.');
  assert.ok(requests.every(r => ['GET', 'HEAD'].includes(r.method)), 'Unexpected write request.');
  assert.deepEqual(errors, []);
  cases.push('no_backend_no_marketing_no_payment_requests');
  console.log(JSON.stringify({ result: 'PASS', unchangedProductionFiles: untouched.length, cases }, null, 2));
} finally {
  await browser.close();
}
