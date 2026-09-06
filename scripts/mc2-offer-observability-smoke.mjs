import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [moduleSource, sessionSource, replaySource, trackerSource] = await Promise.all([
  readFile(new URL('../src/lib/mc2-offer-observability.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/mc2/session.astro', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/mc2/replay.astro', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/track-mc2-event.js', import.meta.url), 'utf8'),
]);

for (const marker of [
  "['core_price', '.core-total']",
  "['bonus_1', '.es2-bonus-card']",
  "['bonus_5', '[data-limited-bonus]']",
  "['pricing', '.deal-summary']",
  "['guarantee', '.preview-guarantee']",
  "['proof', '.video-reviews-section']",
  "['decision', '.two-paths-section']",
  "[25, 50, 75, 90, 100]",
  "emit('invitation_visited'",
  "emit('sales_section_viewed'",
  "emit('sales_scroll'",
]) assert.match(moduleSource, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

assert.match(sessionSource, /startMc2OfferObservability\([\s\S]*route: '\/mc2\/session\/'/);
assert.match(replaySource, /startMc2OfferObservability\([\s\S]*route: '\/mc2\/replay\/'/);
for (const event of ['invitation_visited', 'sales_scroll', 'sales_section_viewed']) {
  assert.match(trackerSource, new RegExp(`'${event}'`));
}
assert.match(moduleSource, /Promise\.resolve\(track\([\s\S]*\.catch\(\(\) => \{\}\)/);

console.log('MC2 offer observability smoke passed');
