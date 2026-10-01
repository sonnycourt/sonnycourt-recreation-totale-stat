import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { KnownDevices } from 'puppeteer';

// Real official embed + real media, no business API requests or customer writes.
// --simulate-head installs the proposed scoped Bunny snippet ONLY in this test
// browser response, before the actual Bunny setting has been approved/installed.
const base = process.env.MC2_TEST_BASE || 'http://127.0.0.1:4391';
const simulateHead = process.argv.includes('--simulate-head');
const mobile = process.argv.includes('--mobile');
const head = readFileSync(new URL('../deploy/bunny-mc2-custom-head.html', import.meta.url), 'utf8');
const screenshots = mkdtempSync(join(tmpdir(), 'mc2-bunny-ui-'));
const browser = await puppeteer.launch({ headless: true });
const results = [];
try {
  for (const mode of (process.argv.includes('--session-only') ? ['session'] : ['session', 'replay'])) {
    const page = await browser.newPage();
    let cutMedia = false;
    const errors = [], parentMedia = [], writes = [], failures = [], logs = [];
    if (mobile) await page.emulate(KnownDevices['iPhone 13']);
    else await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true);
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => failures.push({ url: r.url(), reason: r.failure()?.errorText }));
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) logs.push(`${r.status()} ${r.url()}`); });
    page.on('request', async request => {
      const url = request.url();
      if (cutMedia && /b-cdn\.net\/(6698c2d5-edc9-4f2a-9eea-e98de9f40a3c|b8206f43-4b10-4ddc-a4a6-938a3f1ac78c)\//.test(url)) return request.abort();
      // The offer contains a separate, unchanged short presentation video. Only
      // the two full masterclass sources must be owned exclusively by the iframe.
      if (/\/(6698c2d5-edc9-4f2a-9eea-e98de9f40a3c|b8206f43-4b10-4ddc-a4a6-938a3f1ac78c)\/.*\.m3u8(?:\?|$)/.test(url) && request.frame() === page.mainFrame()) parentMedia.push(url);
      if (request.method() !== 'GET' || /\/\.netlify\/functions\/|metrics-bunny|rum-metrics|bunnyinfra|\.metrics\/|clarity|facebook|google-analytics|googletagmanager|tiktok|stripe|paypal|spiffy|mailerlite/i.test(url)) {
        writes.push(url.split('?')[0]);
        return request.abort();
      }
      if (simulateHead && request.isNavigationRequest() && url.startsWith('https://player.mediadelivery.net/embed/698588/')) {
        try {
          const response = await fetch(url);
          const html = (await response.text()).replace('</head>', `${head}</head>`);
          console.log('SIMULATED_HEAD', response.status, html.length);
          return request.respond({ status: response.status, contentType: 'text/html', body: html });
        } catch { return request.abort(); }
      }
      return request.continue();
    });
    await page.goto(`${base}/mc2/${mode}/?preview=dev&player=bunny`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => !!window.__mcBunnyDiagnostics, { timeout: 20000 });
    // The simulation panel can cover customer buttons in narrow viewports.
    await page.$eval('#dev-time-banner', e => { e.style.display = 'none'; });
    const videoId = mode === 'session' ? 'masterclass-video' : 'replay-video';
    if (mode === 'session') {
      await page.$eval('[data-now-preset="session-p2"]', b => b.click());
      await page.click('#playButton');
    } else {
      await page.click('#play-overlay-btn');
      await page.click('#replay-confirm-btn');
    }
    await page.waitForFunction(id => {
      const v = document.getElementById(id);
      return !v.paused && v.currentTime > 0 && v.readyState >= 2;
    }, { timeout: 35000 }, videoId).catch(async error => {
      console.error('PLAYBACK_FAILURE', await page.evaluate(id => {
        const v = document.getElementById(id);
        return { diagnostics: window.__mcBunnyDiagnostics, time: v?.currentTime, duration: v?.duration,
          paused: v?.paused, ready: v?.readyState, iframe: v?.querySelector('iframe')?.src,
          recovery: document.querySelector('#video-recovery-overlay')?.className };
      }, videoId), { errors, failures: failures.filter(f => /mediadelivery|b-cdn/.test(f.url)), logs });
      for (const f of page.frames().filter(f => f.url().includes('mediadelivery'))) {
        console.error('FRAME', await f.evaluate(() => ({ url: location.href,
          ui: document.documentElement.className, api: !!window.player,
          time: window.player?.getCurrentTime(), paused: window.player?.getPaused(),
          duration: window.player?.getDuration(), body: document.body.innerText.slice(-1200),
          scripts: [...document.scripts].map(s => ({src:s.src,type:s.type})),
          resources: performance.getEntriesByType('resource').map(r => ({name:r.name,size:r.transferSize})) })));
      }
      throw error;
    });
    const start = await page.$eval(`#${videoId}`, v => v.currentTime);
    await new Promise(r => setTimeout(r, 6000));
    const end = await page.$eval(`#${videoId}`, v => v.currentTime);
    assert.ok(end - start > 4, `${mode}: advances without page-driven repair`);
    if (parentMedia.length) console.log('PARENT_MEDIA', JSON.stringify(parentMedia));
    assert.equal(parentMedia.length, 0, 'Only the official Bunny iframe loads video segments');
    const frame = page.frames().find(f => f.url().includes('/embed/698588/'));
    const ui = await frame.evaluate(() => ({
      scoped: document.documentElement.classList.contains('mc2-managed-player'),
      visibleControls: [...document.querySelectorAll('media-control-bar,bunny-media-control-bar,media-play-button')]
        .filter(e => getComputedStyle(e).display !== 'none').length,
    }));
    assert.equal(ui.scoped, true);
    assert.equal(ui.visibleControls, 0);
    if (mobile) {
      // Chromium mobile emulation checks touch/layout/autoplay policy, not iOS
      // WebKit. A physical Safari check is still required before activation.
      await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
      await new Promise(r => setTimeout(r, 6000));
      console.log('MOBILE_STARTED', JSON.stringify({mode, time: await page.$eval(`#${videoId}`, v => v.currentTime)}));
      await page.screenshot({path: join(screenshots, `${mode}-mobile-touch.png`)});
      await page.close();
      continue;
    }
    const controls = mode === 'session'
      ? { rewind: '#rewind15Btn', mute: '#muteBtn', fullscreen: '#fullscreenBtnDesktop' }
      : { rewind: '#rewind-btn', mute: '#mute-btn', fullscreen: '#fullscreen-btn' };
    // The developer-only simulation panel otherwise covers the real fullscreen
    // control on replay; hide that panel, never the customer UI under test.
    await page.$eval('#dev-time-banner', e => { e.style.display = 'none'; });
    await page.click(controls.mute);
    await frame.waitForFunction(() => window.player.getMuted() === true);
    await page.click(controls.mute);
    await frame.waitForFunction(() => window.player.getMuted() === false);
    const beforeRewind = await page.$eval(`#${videoId}`, v => v.currentTime);
    await page.click(controls.rewind);
    await frame.waitForFunction(t => window.player.getCurrentTime() < Math.max(0, t - 15) + 3, {}, beforeRewind);
    if (mode === 'session') {
      await page.waitForSelector('#liveJumpBtn:not(.hidden)');
      await page.click('#liveJumpBtn');
      await frame.waitForFunction(t => window.player.getCurrentTime() >= t - 3, {}, beforeRewind);
    }
    await page.click(controls.fullscreen);
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    const viewportResults = [];
    for (const [width, height, label] of [[1440, 1000, 'desktop'], [390, 844, 'portrait'], [844, 390, 'landscape'], [820, 1180, 'tablet']]) {
      await page.setViewport({ width, height });
      await page.$eval(`#${videoId}`, v => v.scrollIntoView({ block: 'center' }));
      const layout = await page.evaluate(id => {
        const v = document.getElementById(id), rect = v.getBoundingClientRect();
        const hint = document.querySelector('.rotate-hint');
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
          videoWidth: rect.width, videoHeight: rect.height,
          rotateVisible: !!hint && getComputedStyle(hint).display !== 'none' && getComputedStyle(hint).visibility !== 'hidden' };
      }, videoId);
      assert.equal(layout.overflow, false, `${mode} ${label}: no horizontal overflow`);
      assert.ok(layout.videoWidth > 100 && layout.videoHeight > 100, `${mode} ${label}: visible video surface`);
      if (mode === 'session') assert.equal(layout.rotateVisible, label === 'portrait' || label === 'tablet', `${label}: existing rotation instruction retained`);
      await page.screenshot({ path: join(screenshots, `${mode}-${label}.png`) });
      viewportResults.push({ label, ...layout });
    }
    if (process.argv.includes('--resilience')) {
      await page.setViewport({ width: 1440, height: 1000 });
      // Simulate an OS/media interruption, then use the existing recovery UI.
      const beforePause = await page.$eval(`#${videoId}`, v => v.currentTime);
      await frame.evaluate(() => window.player.pause());
      await page.waitForSelector('#video-recovery-overlay.is-visible');
      await page.click('#video-recovery-reload-btn');
      await page.waitForFunction(id => !document.getElementById(id).paused, { timeout: 25000 }, videoId);
      const afterRetry = await page.$eval(`#${videoId}`, v => v.currentTime);
      assert.ok(Math.abs(afterRetry - beforePause) < 4, `${mode}: manual retry preserves passage`);
      const retryFrame = page.frames().find(f => f.url().includes('/embed/698588/'));
      // Force an unbuffered passage during a 15-second media network outage.
      const destination = afterRetry + 180;
      const attachments = await page.evaluate(() => window.__mcBunnyDiagnostics.attachments);
      cutMedia = true;
      await page.$eval(`#${videoId}`, (v, t) => { v.currentTime = t; }, destination);
      await new Promise(r => setTimeout(r, 15000));
      cutMedia = false;
      await retryFrame.waitForFunction(t => window.player.getCurrentTime() > t + 3 && !window.player.getPaused(), { timeout: 45000 }, destination);
      assert.equal(await page.evaluate(() => window.__mcBunnyDiagnostics.attachments), attachments, `${mode}: Bunny resumes without page-driven reconstruction`);
      // CTA must still arrive even though every business/tracking request is blocked.
      if (mode === 'replay') {
        await page.$eval('[data-replay-preset="cta-m10s"]', b => b.click());
        await page.waitForFunction(id => document.getElementById(id).currentTime >= 4532, { timeout: 25000 }, videoId);
      } else {
        await page.$eval('[data-now-preset="cta-active"]', b => b.click());
      }
      await page.waitForSelector('#offer-zone:not(.hidden)', { timeout: 10000 });
      assert.equal(await page.$eval('#deal-sticky-cta', b => b.disabled), false, `${mode}: CTA enabled with tracking unavailable`);
      await page.screenshot({ path: join(screenshots, `${mode}-cta.png`) });
      await page.$eval(`#${videoId}`, v => {
        // The existing live end handler intentionally seeks back to zero, which
        // clears .ended. Observe delivery of the event instead of that property.
        v.addEventListener('ended', () => { v.dataset.testEnded = 'true'; }, {once:true});
        v.currentTime = v.duration - 2;
      });
      await page.waitForFunction(id => document.getElementById(id).dataset.testEnded === 'true', { timeout: 25000 }, videoId).catch(async error => {
        console.error('END_FAILURE', await page.$eval(`#${videoId}`, v => ({time:v.currentTime,duration:v.duration,paused:v.paused,ended:v.ended,diagnostics:v.diagnostics})), await retryFrame.evaluate(() => ({time:window.player.getCurrentTime(),duration:window.player.getDuration(),paused:window.player.getPaused()})));
        throw error;
      });
      assert.equal(await page.$eval('#offer-zone', e => e.classList.contains('hidden')), false, `${mode}: offer remains after video ends`);
      assert.equal(await page.$eval('#video-recovery-overlay', e => e.classList.contains('is-visible')), false, `${mode}: no false error overlay at normal end`);
    }
    assert.deepEqual(errors, [], `${mode}: no JavaScript error`);
    results.push({ mode, start, end, ui, viewports: viewportResults, diagnostics: await page.evaluate(() => window.__mcBunnyDiagnostics), blockedRequests: writes.length });
    console.log(JSON.stringify(results.at(-1)));
    await page.close();
  }
  console.log(JSON.stringify({ pass: true, simulatedBunnySetting: simulateHead, screenshots }));
} finally { await browser.close(); }
