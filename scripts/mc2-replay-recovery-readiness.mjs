const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MAILERLITE_API_KEY',
  'MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW',
  'MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA',
  'MAILERLITE_GROUP_MC2_OFFER_SEEN',
  'MAILERLITE_GROUP_MC2_REPLAY_24H',
  'MAILERLITE_GROUP_MC2_REPLAY_4H',
  'MC2_REPLAY_VIDEO_URL',
  'MC2_REPLAY_CTA_SECONDS',
];
const missing = required.filter((key) => !String(process.env[key] || '').trim());
const summary = {
  ready: missing.length === 0,
  enabled: String(process.env.MC2_REPLAY_RECOVERY_ENABLED || '').toLowerCase() === 'true',
  missing,
  safety: 'Le système doit rester enabled=false jusqu’à validation des 5 emails replay/downsell.',
};
console.log(JSON.stringify(summary, null, 2));
if (missing.length) process.exitCode = 1;
