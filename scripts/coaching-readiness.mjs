const groups = {
  supabase: [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ],
  spiffy: [
    'COACHING_SPIFFY_WEBHOOK_TOKEN',
    'SPIFFY_FIRST_CONSULTATION_IDS',
    'SPIFFY_COACHING_SESSION_1_IDS',
    'SPIFFY_COACHING_PACK_3_IDS',
    'SPIFFY_COACHING_PACK_6_IDS',
    'PUBLIC_SPIFFY_COACHING_SESSION_1_URL',
    'PUBLIC_SPIFFY_COACHING_PACK_3_URL',
    'PUBLIC_SPIFFY_COACHING_PACK_6_URL',
  ],
  google: [
    'GOOGLE_COACHING_CLIENT_ID',
    'GOOGLE_COACHING_CLIENT_SECRET',
    'COACHING_TOKEN_ENCRYPTION_KEY',
    'COACHING_SYNC_SECRET',
  ],
  email: [
    'MAILERSEND_API_KEY',
    'COACHING_EMAIL_FROM',
  ],
};

const report = Object.fromEntries(Object.entries(groups).map(([group, names]) => {
  const missing = names.filter((name) => !String(process.env[name] || '').trim());
  return [group, { ready: missing.length === 0, missing }];
}));
const missing = Object.values(report).flatMap((item) => item.missing);

console.log(JSON.stringify({
  ready: missing.length === 0,
  groups: report,
  optional: {
    SPIFFY_SIGNING_SECRET: Boolean(process.env.SPIFFY_SIGNING_SECRET),
    COACHING_EMAIL_FROM_NAME: Boolean(process.env.COACHING_EMAIL_FROM_NAME),
  },
}, null, 2));

if (missing.length) process.exitCode = 1;
