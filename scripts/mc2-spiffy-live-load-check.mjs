// Read-only provider UI check: every non-GET request is blocked, no submission.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const origin = 'https://sonnycourt.com';
const root = new URL('../', import.meta.url);
const browser = await puppeteer.launch({ headless: true });
try {
  for (const width of [390, 1000]) {
    const page = await browser.newPage();
    const blocked = [];
    await page.setViewport({ width, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) {
        blocked.push(u.origin + u.pathname);
        return req.abort();
      }
      if (u.origin === origin) {
        if (u.pathname === '/__mc2-readonly-check/') return req.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:#f7f9fc}#slot{max-width:700px;margin:auto}iframe{width:100%;border:0}</style><div id="slot"></div><script type="module">import {mountDraftXSpiffy} from '/__qa/mc2-draftx-spiffy.mjs';import {DRAFTX_PAYMENT_PLANS} from '/__qa/mc2-draftx-checkout.mjs';window.mountPlan=key=>{window.handle?.destroy();window.handle=mountDraftXSpiffy(document.querySelector('#slot'),DRAFTX_PAYMENT_PLANS[key],{firstName:'Verification',email:'verification@example.invalid'});};</script>` });
        if (['/__qa/mc2-draftx-spiffy.mjs', '/__qa/mc2-draftx-checkout.mjs'].includes(u.pathname)) {
          return req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('src/lib/' + u.pathname.split('/').pop(), root)) });
        }
        return req.abort();
      }
      // Provider assets only. Never allow navigation to another checkout.
      if (u.protocol === 'https:' && /(^|\.)(spiffy\.co|stripe\.com|stripe\.network|paypal\.com|paypalobjects\.com|googleapis\.com|gstatic\.com|jsdelivr\.net)$/.test(u.hostname)) return req.continue();
      return req.abort();
    });
    await page.goto(origin + '/__mc2-readonly-check/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.mountPlan === 'function');
    for (const key of ['once', 'twelve']) {
      await page.evaluate(key => window.mountPlan(key), key);
      await page.waitForFunction(() => document.querySelector('#slot')?.getAttribute('aria-busy') === 'false', { timeout: 30000 });
      const state = await page.$eval('#slot', el => ({ ready: el.dataset.identityTransmitted, opacity: el.querySelector('iframe')?.style.opacity, height: el.querySelector('iframe')?.style.height, loadingText: el.querySelector('p')?.textContent || '' }));
      assert.equal(state.ready, 'true', JSON.stringify(state));
      assert.equal(state.opacity, '1', JSON.stringify(state));
      const provider = page.frames().find(frame => frame.url().startsWith('https://sonnycourt.spiffy.co/checkout/'));
      assert.ok(provider);
      const payment = await provider.evaluate(() => ({
        identityStyle: Boolean(document.querySelector('#mc2-prefilled-identity-hidden')),
        stripeFrames: [...document.querySelectorAll('iframe')].filter(el => el.src.includes('stripe.com')).map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
        cardInput: Boolean(document.querySelector('.StripeElement')),
        bodyHeight: document.body.scrollHeight,
      }));
      assert.ok(payment.identityStyle);
      assert.ok(payment.cardInput);
      assert.ok(payment.stripeFrames.some(frame => frame.width > 100 && frame.height > 10 && frame.height < 150), JSON.stringify(payment));
      await page.screenshot({ path: '/private/tmp/mc2-spiffy-live-' + key + '-' + width + '.png', fullPage: true });
      console.log(JSON.stringify({ plan: key, width, state, payment, blockedNonGet: blocked.length, submitted: false }));
    }
    await page.close();
  }
} finally { await browser.close(); }
