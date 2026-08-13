import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

const sourceUrl = process.env.MC2_CGV_SOURCE_URL || 'http://127.0.0.1:4351/cgv/';
const outputPath = path.resolve('public/legal-archives/mc2-cgv-2026-08-v3.pdf');

await fs.mkdir(path.dirname(outputPath), { recursive: true });

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(sourceUrl, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('print');
  await page.addStyleTag({ content: `
    nav, footer, .cookie-banner, .cookie-modal { display: none !important; }
    html, body { overflow: visible !important; }
    .legal-page { padding-top: 0 !important; }
    .legal-content { padding-bottom: 24px !important; }
    .legal-card { break-inside: auto !important; }
  ` });
  await page.pdf({
    path: outputPath,
    format: 'A4',
    scale: 0.85,
    printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    displayHeaderFooter: false,
    preferCSSPageSize: false,
  });
} finally {
  await browser.close();
}

console.log(outputPath);
