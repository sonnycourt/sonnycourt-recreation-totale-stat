import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const source = readFileSync(new URL('../src/pages/delta-vision/merci.astro', import.meta.url), 'utf8');
const invitation = source.match(/const invitationUrl = '([^']+)'/)[1];
const url = new URL(invitation);
assert.equal(url.origin, 'https://volt.sonnycourt.com');
assert.equal(url.pathname, '/join');
assert.equal(url.searchParams.get('invitation_token'), '8445b8e19f28836e669caff44365c4e46d5da44f-54ebffc4-c501-4529-8a65-ee0f5f8cd971');
assert.match(source, /href=\{invitationUrl\}/);
assert.match(source, /noindex,nofollow,noarchive/);
assert.match(source, /name="referrer" content="no-referrer"/);
assert.match(source, /Tes accès t’ont été envoyés par email/);
assert.match(source, /même adresse email que lors de ton achat/);
assert.doesNotMatch(source, /<script|<form|fetch\(|localStorage|sessionStorage/);
assert.ok(existsSync(new URL('../public/media/pages/inspira-vsl-jungle-v2.webp', import.meta.url)));
console.log('Delta Vision thank-you: link, copy, indexing, assets and no side effects verified.');
