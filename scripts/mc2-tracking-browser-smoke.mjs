import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
const browserName = process.env.MC2_TEST_BROWSER || 'chrome';
const silentSpiffy = process.env.MC2_TEST_SPIFFY_SILENT === '1';
const browser = await puppeteer.launch({ headless: true, ...(browserName === 'firefox' ? { browser: 'firefox', executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox' } : {}) });
const rootDir = path.resolve(new URL('..', import.meta.url).pathname);
const token = randomUUID();
try {
  for (const route of ['/mc2/session/', '/mc2/replay/']) {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    await page.setViewport({ width: route.includes('replay') ? 390 : 1200, height: 844 });
    const cta = route.includes('replay') ? 4490 : 5690;
    // The session's announced hour is 15 min after media start; replay removes 20 min of content.
    const startedAt = Date.now() - (5690 - 900 - 3) * 1000;
    const events = [], calls = [], errors = []; let outage = false;
    const capturedBodies = new Map();
    if (browserName === 'firefox') {
      await page.exposeFunction('__fixtureCaptureBody', body => { const id = randomUUID(); capturedBodies.set(id, body); return id; });
      await page.evaluateOnNewDocument(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (url, options) => {
          if (String(url).includes('/track-mc2-journey')) {
            const id = await window.__fixtureCaptureBody(options.body);
            return original(url, { ...options, headers: { ...options.headers, 'x-test-body': id } });
          }
          return original(url, options);
        };
      });
    }
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async request => {
      try {
      if (request.isInterceptResolutionHandled()) return;
      if (request.interceptResolutionState().action === 'disabled') {
        assert.equal(new URL(request.url()).hostname, 'mc2-tracking.test', 'Only cached local fixtures may bypass interception');
        assert.ok(new URL(request.url()).pathname.startsWith('/media/'), 'Application requests must remain intercepted');
        return;
      }
      const url = new URL(request.url());
      calls.push({ host: url.hostname, path: url.pathname, method: request.method() });
      if (url.hostname === 'sonnycourt.spiffy.co') {
        await request.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="UTF-8"><p>Faux formulaire — aucun paiement possible</p>' + (silentSpiffy ? '' : '<script>setTimeout(()=>{parent.postMessage({type:"mc2:draftx-spiffy-height",height:310},"*");parent.postMessage({type:"mc2:draftx-spiffy-ready",identityReady:true},"*")},200)</script>') }); return;
      }
      if (url.hostname !== 'mc2-tracking.test') { await request.abort(); return; }
      if (url.pathname.startsWith('/.netlify/functions/')) {
        let body = { ok: true, offer_sms_queued: true, offer_expires_at: new Date(Date.now() + 86400000).toISOString() };
        if (url.pathname.endsWith('get-mc2-registration')) body = { valid: true, token, prenom: 'Fixture', email: 'fixture@example.invalid', pays: 'France', attended_live: true, sessionStartsAt: new Date(startedAt).toISOString(), statut: 'inscrit' };
        if (url.pathname.endsWith('mc2-replay-access')) body = { valid: true, registrationToken: token, firstName: 'Fixture', email: 'fixture@example.invalid', country: 'France', resumeSeconds: cta - 3, expiresAt: new Date(Date.now() + 86400000).toISOString(), offerExpiresAt: new Date(Date.now() + 86400000).toISOString() };
        if (url.pathname.endsWith('track-mc2-journey')) {
          const batch = JSON.parse(browserName === 'firefox' ? capturedBodies.get(request.headers()['x-test-body']) : request.postData()).events;
          if (!outage) events.push(...batch);
          await request.respond({ status: outage ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ accepted: outage ? [] : batch.map(e => e.event_id), rejected: [] }) }); return;
        }
        await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); return;
      }
      const filename = path.join(rootDir, 'dist', url.pathname, url.pathname.endsWith('/') ? 'index.html' : '');
      if (!filename.startsWith(path.join(rootDir, 'dist') + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { await request.respond({ status: 404, body: '' }); return; }
      const mime = filename.endsWith('.html') ? 'text/html' : filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : filename.endsWith('.svg') ? 'image/svg+xml' : filename.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
      await request.respond({ status: 200, contentType: mime, body: fs.readFileSync(filename) });
      } catch (error) {
        // Firefox BiDi can report requests after the transport has already aborted them.
        // Surface the harness failure; do not turn it into an application success.
        errors.push('interception:' + new URL(request.url()).pathname + ':' + error.message);
      }
    });
    // Only the media source is simulated; real built page, access, checkout and analytics run.
    await page.evaluateOnNewDocument((cta, route) => {
      const values = new WeakMap();
      const state = video => { if (!values.has(video)) values.set(video, { position: cta - 3, start: performance.now(), paused: true }); return values.get(video); };
      const position = video => { const v = state(video); return v.position + (v.paused ? 0 : (performance.now() - v.start) / 1000); };
      Object.defineProperties(HTMLMediaElement.prototype, {
        currentTime: { configurable: true, get() { return position(this); }, set(value) { const v = state(this); v.position = value; v.start = performance.now(); } },
        paused: { configurable: true, get() { return state(this).paused; } }, ended: { configurable: true, get: () => false },
        readyState: { configurable: true, get: () => 4 }, duration: { configurable: true, get: () => route.includes('replay') ? 6719 : 7920 },
      });
      HTMLMediaElement.prototype.canPlayType = () => 'probably';
      HTMLVideoElement.prototype.getVideoPlaybackQuality = function () { return { totalVideoFrames: Math.floor(position(this) * 25) }; };
      HTMLMediaElement.prototype.play = function () { const v = state(this); v.position = position(this); v.start = performance.now(); v.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { const v = state(this); v.position = position(this); v.paused = true; this.dispatchEvent(new Event('pause')); };
      HTMLMediaElement.prototype.load = function () { for (const event of ['loadedmetadata', 'loadeddata', 'canplay']) setTimeout(() => this.dispatchEvent(new Event(event)), 50); };
      setInterval(() => document.querySelectorAll('video').forEach(v => { if (!v.paused) v.dispatchEvent(new Event('timeupdate')); }), 250);
    }, cta, route);
    await page.goto('https://mc2-tracking.test' + route + (route.includes('replay') ? '?access=fixture-access' : '?t=' + token), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mc2JourneyV2?.schema === 2);
    await page.waitForFunction(() => document.querySelector('[data-draftx-checkout]')?.dataset.registrationToken);
    if (route.includes('replay')) await page.click('#replay-confirm-btn');
    else { await page.waitForSelector('#playButton', { visible: true }); await page.click('#playButton'); }
    await page.waitForFunction(() => document.querySelector('[data-draftx-checkout]')?.dataset.checkoutAvailable === 'true', { timeout: 15000 });
    await page.evaluate(() => document.querySelector('#deal-offer-content').scrollIntoView());
    for (let i = 0; i < 40 && !events.some(e => e.event_name === 'offer_visible'); i++) await new Promise(resolve => setTimeout(resolve, 200));
    // Trusted real scroll gesture, then a CTA click through the real offer.
    await page.mouse.wheel({ deltaY: 220 });
    await new Promise(resolve => setTimeout(resolve, 500));
    if (!events.some(e => e.event_name === 'offer_visible')) console.log('Offer diagnostic', await page.evaluate(() => ({ status: window.__mc2JourneyV2.status(), offer: document.querySelector('#deal-offer-content').getBoundingClientRect().toJSON(), style: getComputedStyle(document.querySelector('#deal-offer-content')).cssText, available: document.querySelector('[data-draftx-checkout]').dataset.checkoutAvailable, visibility: document.visibilityState, fullscreen: !!document.fullscreenElement })), [...new Set(events.map(e => e.event_name))]);
    await page.evaluate(() => document.querySelector('[data-checkout-open]').scrollIntoView({ block: 'center' }));
    await page.click('[data-checkout-open]');
    await page.waitForSelector('#draftx-checkout-dialog[open]');
    await page.click('[data-checkout-step="1"] button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[data-draftx-checkout]').dataset.step === '2');
    for (const plan of ['twelve', 'six']) {
      await page.click(`[data-payment-plan="${plan}"]`);
      await page.click('[data-checkout-step="2"] button[type="submit"]');
      await page.waitForFunction(() => document.querySelector('[data-spiffy-slot]')?.getAttribute('aria-busy') === 'false');
      // The existing opacity transition finishes after the busy flag clears.
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-spiffy-slot] iframe')).opacity === '1', { timeout: 2000 });
      assert.equal(await page.$eval('[data-draftx-checkout]', el => el.dataset.step), '3');
      assert.ok((await page.$eval('[data-spiffy-slot] iframe', el => el.src)).includes(plan === 'twelve' ? '38556364' : '38556365'));
      assert.equal(await page.$eval('[data-spiffy-slot] iframe', el => getComputedStyle(el).opacity), '1');
      assert.equal(await page.$eval('[data-spiffy-slot] iframe', el => el.getAttribute('aria-hidden')), 'false');
      if (silentSpiffy) {
        assert.equal(await page.$('.draftx-spiffy-recovery a'), null, 'First failure offers retry only');
        await page.click('.draftx-spiffy-recovery button');
        await page.waitForSelector('.draftx-spiffy-recovery a', { visible: true });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-spiffy-slot] iframe')).opacity === '1');
      }
      await page.click('[data-checkout-step="3"] [data-checkout-back]');
    }
    await page.click('[data-checkout-close]');
    outage = true;
    await page.click('[data-checkout-open]');
    await page.click('[data-checkout-close]');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.ok((await page.evaluate(() => window.__mc2JourneyV2.status())).queued > 0);
    const persisted = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mc2_tracking_queue_v2')).map(e => e.event_id));
    outage = false; await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__mc2JourneyV2?.status().acknowledged > 0);
    assert.ok(persisted.every(id => events.some(e => e.event_id === id)), 'Reload retries the original IDs');
    for (const name of ['journey_started', 'playback_started', 'cta_playback_present', 'offer_visible', 'offer_scroll_started', 'checkout_opened', 'checkout_step_viewed', 'checkout_step_completed', 'payment_frame_visible', 'checkout_closed']) assert.ok(events.some(e => e.event_name === name), name + ' absent');
    for (const step of [1, 2, 3]) assert.ok(events.some(e => e.event_name === 'checkout_step_viewed' && e.metadata.step === step));
    assert.equal(await page.evaluate(() => window.__mc2JourneyV2.status().observerErrors), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: browserName, silentSpiffy, route, events: events.length, uniqueEvents: new Set(events.map(e => e.event_id)).size, checkoutSteps: '1→2→3', bothPlans: true, reloadAck: true, pageErrors: errors.length, allRequestsIntercepted: true }));
    await context.close();
  }
} finally { await browser.close(); }
