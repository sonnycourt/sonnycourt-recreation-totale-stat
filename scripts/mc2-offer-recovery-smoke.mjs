import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/offre/index.astro', import.meta.url), 'utf8');
const requestAccess = fs.readFileSync(new URL('../netlify/functions/request-mc2-access.js', import.meta.url), 'utf8');
const redirects = fs.readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');

assert.match(page, /<meta name="robots" content="index, follow"/);
assert.match(page, /<link rel="canonical" href="https:\/\/sonnycourt\.com\/offre\/"/);
assert.match(page, /Retrouve ton offre personnelle/);
assert.match(page, /Adresse email utilisée lors de ton inscription/);
assert.match(page, /mc2_registration_token/);
assert.match(page, /masterclass_es2_token/);
assert.match(page, /webinaire_es2_token/);
assert.match(page, /get-mc2-registration\?t=/);
assert.match(page, /window\.location\.replace\(`\$\{SESSION_PATH\}\?t=/);
assert.match(page, /body: JSON\.stringify\(\{ email,page_path: '\/offre\/' \}\)/);
assert.match(page, /const token = String\(data.token/);
assert.match(page, /redirectToOffer\(token\)/);
assert.doesNotMatch(page, /t’envoyer ton lien|vient d’être envoyé/);
assert.doesNotMatch(page, /check-mc2-eligibility/);
assert.doesNotMatch(page, /userAgent|navigator\.userAgent|facebookexternalhit/i);

assert.match(requestAccess, /select=token&order=registered_at.desc&limit=1/);
assert.doesNotMatch(requestAccess, /MAILERSEND|api\.mailersend|MC2_OFFER_RECOVERY_EMAIL_ENABLED/);
assert.match(redirects, /from = "\/offre"[\s\S]*?to = "\/offre\/index\.html"/);
assert.match(redirects, /from = "\/offre\/"[\s\S]*?to = "\/offre\/index\.html"/);

await import('./mc2-access-recovery-smoke.mjs');

console.log(JSON.stringify({
  public_route: '/offre/',
  known_visitor: 'token_validation_then_session_redirect',
  unknown_visitor: 'email_lookup_then_immediate_access_without_sending',
  meta_review: 'public_200_recovery_page',
}, null, 2));
