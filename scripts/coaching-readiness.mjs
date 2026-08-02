const groups = {
  app: [
    'COACHING_APP_ORIGIN',
  ],
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
  return [group, { ready: missing.length === 0, missing, invalid: [] }];
}));

const isHttpsUrl = (name) => {
  try { return new URL(process.env[name]).protocol === 'https:'; }
  catch { return false; }
};
const invalidate = (group, name, valid) => {
  if (!report[group].missing.includes(name) && !valid) report[group].invalid.push(name);
};

invalidate('supabase', 'SUPABASE_URL', isHttpsUrl('SUPABASE_URL'));
invalidate('supabase', 'PUBLIC_SUPABASE_URL', isHttpsUrl('PUBLIC_SUPABASE_URL'));
if (process.env.SUPABASE_URL && process.env.PUBLIC_SUPABASE_URL) {
  invalidate('supabase', 'PUBLIC_SUPABASE_URL', process.env.SUPABASE_URL.replace(/\/$/, '') === process.env.PUBLIC_SUPABASE_URL.replace(/\/$/, ''));
}
if (process.env.SUPABASE_PUBLISHABLE_KEY && process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  invalidate('supabase', 'PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.SUPABASE_PUBLISHABLE_KEY === process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
invalidate('spiffy', 'COACHING_SPIFFY_WEBHOOK_TOKEN', String(process.env.COACHING_SPIFFY_WEBHOOK_TOKEN || '').length >= 32);
for (const name of ['PUBLIC_SPIFFY_COACHING_SESSION_1_URL', 'PUBLIC_SPIFFY_COACHING_PACK_3_URL', 'PUBLIC_SPIFFY_COACHING_PACK_6_URL']) {
  invalidate('spiffy', name, isHttpsUrl(name));
}
invalidate('google', 'COACHING_TOKEN_ENCRYPTION_KEY', String(process.env.COACHING_TOKEN_ENCRYPTION_KEY || '').length >= 32);
invalidate('google', 'COACHING_SYNC_SECRET', String(process.env.COACHING_SYNC_SECRET || '').length >= 32);
invalidate('email', 'COACHING_EMAIL_FROM', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(process.env.COACHING_EMAIL_FROM || '')));
invalidate('app', 'COACHING_APP_ORIGIN', String(process.env.COACHING_APP_ORIGIN || '').replace(/\/$/, '') === 'https://coaching.sonycourt.com');

for (const group of Object.values(report)) group.ready = group.missing.length === 0 && group.invalid.length === 0;
const missing = Object.values(report).flatMap((item) => item.missing);
const invalid = Object.values(report).flatMap((item) => item.invalid);

console.log(JSON.stringify({
  ready: missing.length === 0 && invalid.length === 0,
  groups: report,
  optional: {
    SPIFFY_SIGNING_SECRET: Boolean(process.env.SPIFFY_SIGNING_SECRET),
    COACHING_EMAIL_FROM_NAME: Boolean(process.env.COACHING_EMAIL_FROM_NAME),
  },
}, null, 2));

if (missing.length || invalid.length) process.exitCode = 1;
