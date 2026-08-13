import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/pages/mc2/session.astro'), 'utf8');

const checks = {
  mc2_email_recovery: source.includes("fetch('/.netlify/functions/check-mc2-eligibility'"),
  legacy_email_recovery_removed: !source.includes("fetch('/.netlify/functions/check-webinaire-eligibility'"),
  fresh_registration_allowed: source.includes('if (!data.valid || !data.sessionStartsAt)')
    && !source.includes('if (!data.valid || !data.sessionStartsAt || !data.offreExpiresAt)'),
  checkout_controls_offer_deadline: source.includes("const expiryMs = reg.offreExpiresAt ? new Date(reg.offreExpiresAt).getTime() : NaN"),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ checks, failed }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(checks, null, 2));
