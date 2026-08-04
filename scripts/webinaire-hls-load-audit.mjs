import puppeteer from 'puppeteer';

const baseUrl = process.argv[2] || process.env.WEBINAIRE_TEST_URL || 'http://127.0.0.1:4321/masterclass/session?preview=dev';
const viewerCount = Math.max(3, Number(process.argv[3] || process.env.WEBINAIRE_TEST_VIEWERS || 30));
const batchSize = Math.max(1, Math.min(5, Number(process.env.WEBINAIRE_TEST_BATCH_SIZE || 5)));
const observationMs = Math.max(20_000, Number(process.argv[4] || process.env.WEBINAIRE_TEST_DURATION_MS || 32_000));
const forcedOutageMs = Number(process.argv[5] || process.env.WEBINAIRE_TEST_OUTAGE_MS || 0);

const profiles = [
  { name: 'fibre', latency: 20, downMbps: 20, upMbps: 8, connectionType: 'wifi', outageMs: 0 },
  { name: 'wifi', latency: 55, downMbps: 8, upMbps: 3, connectionType: 'wifi', outageMs: 0 },
  {
    name: '4g-variable',
    latency: 100,
    downMbps: 3,
    upMbps: 1,
    connectionType: 'cellular4g',
    outageMs: forcedOutageMs > 0 ? forcedOutageMs : 8_000,
  },
];

const browserLaunchOptions = {
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--no-sandbox',
  ],
};

function networkConditions(profile, offline = false) {
  return {
    offline,
    latency: profile.latency,
    downloadThroughput: profile.downMbps * 1024 * 1024 / 8,
    uploadThroughput: profile.upMbps * 1024 * 1024 / 8,
    connectionType: profile.connectionType,
  };
}

async function setNetwork(client, profile, offline = false) {
  await client.send('Network.emulateNetworkConditions', networkConditions(profile, offline));
}

async function runViewer(index) {
  const profile = profiles[index % profiles.length];
  const browser = await puppeteer.launch(browserLaunchOptions);
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  const pageErrors = [];
  const failedMediaRequests = [];

  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('requestfailed', (request) => {
    if (/\.m3u8|\.ts(?:\?|$)/i.test(request.url())) {
      failedMediaRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
    }
  });

  try {
    await page.setViewport({ width: 640, height: 420, deviceScaleFactor: 1 });
    await client.send('Network.enable');
    await setNetwork(client, profile);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await page.waitForFunction(() => Boolean(window.__mcHlsDiagnostics), { timeout: 45_000 });
    await page.waitForSelector('[data-now-preset="session-p2"]', { timeout: 20_000 });
    await page.$eval('[data-now-preset="session-p2"]', (button) => button.click());
    await page.waitForSelector('#playButton', { timeout: 20_000 });
    // Comme un vrai retardataire, cliquer même si les métadonnées ne sont pas encore
    // chargées : le lecteur possède précisément un chemin pendingForceLiveSeek pour ce cas.
    await page.$eval('#playButton', (button) => button.click());
    await page.waitForFunction(() => {
      const video = document.getElementById('masterclass-video');
      return video && !video.paused && video.currentTime > 0;
    }, { timeout: 45_000 });

    const startTime = await page.$eval('#masterclass-video', (video) => video.currentTime);
    const outageDelayMs = Math.min(10_000, Math.max(5_000, observationMs / 3));
    if (profile.outageMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, outageDelayMs));
      await setNetwork(client, profile, true);
      await new Promise((resolve) => setTimeout(resolve, profile.outageMs));
      await setNetwork(client, profile, false);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, observationMs - outageDelayMs - profile.outageMs)));
    } else {
      await new Promise((resolve) => setTimeout(resolve, observationMs));
    }

    const result = await page.evaluate((initialTime) => {
      const video = document.getElementById('masterclass-video');
      const diagnostics = window.__mcHlsDiagnostics || {};
      return {
        advancedSeconds: Math.max(0, Number(video?.currentTime || 0) - initialTime),
        paused: Boolean(video?.paused),
        mediaErrorCode: video?.error?.code || null,
        sourceAttachments: diagnostics.sourceAttachments || 0,
        hardReloads: diagnostics.hardReloads || 0,
        softRecoveries: diagnostics.softRecoveries || 0,
        fatalErrors: diagnostics.fatalErrors || [],
        manifestLevels: diagnostics.manifestLevels || [],
        firstLevelHeight: diagnostics.levelSwitches?.[0]?.height || null,
      };
    }, startTime);

    const pass = result.advancedSeconds >= 8
      && result.mediaErrorCode === null
      && result.hardReloads === 0
      && result.sourceAttachments === 1
      && result.manifestLevels.length >= 4
      && result.firstLevelHeight === 360
      && pageErrors.length === 0;

    return { index: index + 1, profile: profile.name, pass, ...result, pageErrors, failedMediaRequests };
  } catch (error) {
    const diagnosticSnapshot = await page.evaluate(() => {
      const video = document.getElementById('masterclass-video');
      return {
        readyState: video?.readyState ?? null,
        paused: video?.paused ?? null,
        currentTime: video?.currentTime ?? null,
        networkState: video?.networkState ?? null,
        mediaErrorCode: video?.error?.code || null,
        diagnostics: window.__mcHlsDiagnostics || null,
      };
    }).catch(() => null);
    return {
      index: index + 1,
      profile: profile.name,
      pass: false,
      fatalTestError: String(error?.stack || error),
      diagnosticSnapshot,
      pageErrors,
      failedMediaRequests,
    };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const results = [];
for (let offset = 0; offset < viewerCount; offset += batchSize) {
  const indexes = Array.from({ length: Math.min(batchSize, viewerCount - offset) }, (_, i) => offset + i);
  results.push(...await Promise.all(indexes.map((index) => runViewer(index))));
}

const summary = profiles.map((profile) => {
  const rows = results.filter((row) => row.profile === profile.name);
  return {
    profile: profile.name,
    viewers: rows.length,
    passed: rows.filter((row) => row.pass).length,
    hardReloads: rows.reduce((sum, row) => sum + Number(row.hardReloads || 0), 0),
    fatalErrors: rows.reduce((sum, row) => sum + Number(row.fatalErrors?.length || 0), 0),
    averageProgressSeconds: rows.length
      ? Math.round(rows.reduce((sum, row) => sum + Number(row.advancedSeconds || 0), 0) / rows.length * 10) / 10
      : 0,
  };
});

console.log(JSON.stringify({ baseUrl, viewerCount, observationMs, summary }, null, 2));

const failures = results.filter((row) => !row.pass);
if (failures.length) {
  console.error(JSON.stringify({ failedViewers: failures }, null, 2));
  process.exitCode = 1;
}
