import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isLegacyWebinarPostponed,
  LEGACY_WEBINAR_POSTPONEMENT,
} from '../netlify/functions/lib/legacy-webinar-postponement.mjs';

assert.equal(LEGACY_WEBINAR_POSTPONEMENT.localDate, '2026-08-20');
assert.equal(LEGACY_WEBINAR_POSTPONEMENT.slot, '20h');

assert.equal(isLegacyWebinarPostponed({
  creneau: '20h',
  session_date: '2026-08-20T18:00:00.000Z',
}), true, 'la session du 20 août à 20 h Paris doit être bloquée');

assert.equal(isLegacyWebinarPostponed({
  creneau: '20h',
  session_date: '2026-08-20T20:00:00+02:00',
}), true, 'une représentation ISO équivalente doit être bloquée');

assert.equal(isLegacyWebinarPostponed({
  creneau: '20h',
  session_date: '2026-08-20T18:00:00.123Z',
}), true, 'une variation sans effet de précision doit rester bloquée');

assert.equal(isLegacyWebinarPostponed({
  creneau: '14h',
  session_date: '2026-08-20T18:00:00.000Z',
}), false, 'un autre créneau ne doit jamais être bloqué');

assert.equal(isLegacyWebinarPostponed({
  creneau: '20h',
  session_date: '2026-08-27T18:00:00.000Z',
}), false, 'une autre date ne doit jamais être bloquée');

const apiSource = await readFile(new URL('../netlify/functions/get-webinaire-registration.js', import.meta.url), 'utf8');
const confirmationSource = await readFile(new URL('../src/pages/masterclass/confirmation.astro', import.meta.url), 'utf8');
const sessionSource = await readFile(new URL('../src/pages/masterclass/session.astro', import.meta.url), 'utf8');

assert.match(apiSource, /isLegacyWebinarPostponed\(row\)/);
assert.ok(
  apiSource.indexOf('isLegacyWebinarPostponed(row)') < apiSource.indexOf('purchased = await isInMailerLiteAcheteursGroup'),
  'le blocage doit intervenir avant les appels MailerLite et WhatsApp',
);
assert.match(apiSource, /sessionPostponed:\s*true/);
assert.match(confirmationSource, /id="postponed-state"/);
assert.match(confirmationSource, /showPostponedState\(data\)/);
assert.match(sessionSource, /showPostponedBlocked\(data\)/);
assert.match(sessionSource, /id="blocked-badge"/);

console.log('webinaire postponement smoke: OK');
