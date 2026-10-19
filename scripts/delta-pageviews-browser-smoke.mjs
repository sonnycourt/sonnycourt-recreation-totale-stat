// Test the compiled production page without sending anything to production.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const browser = await puppeteer.launch({ headless: true });
try {
  for (const allowed of [false, null]) {
    const page = await browser.newPage(), counts = [], detailed = [];
    await page.setRequestInterception(true);
    page.on('request', async req => {
      const url = new URL(req.url());
      if (url.pathname === '/.netlify/functions/delta-vision-pageview') {
        counts.push({ headers: req.headers(), body: req.postData() });
        return req.respond({ status: 204 });
      }
      if (url.pathname === '/.netlify/functions/delta-vision-track') detailed.push(req.url());
      if (url.hostname !== 'sonnycourt.com' || url.pathname.startsWith('/.netlify/')) return req.abort();
      const target = path.resolve('dist', '.' + url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
      if (!target.startsWith(path.resolve('dist') + '/')) return req.abort();
      try {
        const body = await readFile(target);
        const type = target.endsWith('.html') ? 'text/html' : target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
        await req.respond({ status: 200, contentType: type, body });
      } catch { await req.abort(); }
    });
    await page.evaluateOnNewDocument(allowed => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      document.cookie = 'qa_cookie=must_not_be_sent; path=/; Secure';
      if (allowed !== null) localStorage.setItem('dv_analytics_consent_v1', JSON.stringify({ allowed, at: Date.now() }));
    }, allowed);
    await page.goto('https://sonnycourt.com/delta-vision/?private=must_not_be_sent', { waitUntil: 'networkidle0' });
    assert.equal(counts.length, 1);
    assert.equal(counts[0].body, 'view');
    assert(!counts[0].headers.cookie);
    assert(!counts[0].headers.referer);
    assert.equal(detailed.length, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('dv_analytics_visitor_v1')), null);
    if (allowed === null) await page.click('[data-dv-consent="no"]');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(counts.length, 1);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(counts.length, 2, 'a real reload is a second pageview');
    assert.equal(detailed.length, 0);
    await page.close();
  }
  console.log('PASS compiled browser: refusal/unanswered counted, no cookies/referrer/visitor ID, no detailed events, reload semantics');
} finally { await browser.close(); }
