const required = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MAILERLITE_API_KEY',
  'MAILERLITE_GROUP_MC2_CONFIRMATION', 'MAILERLITE_GROUP_MC2_SESSION_REMINDER_1H',
];
const missing = required.filter((name) => !String(process.env[name] || '').trim());
console.log(JSON.stringify({
  ready: missing.length === 0,
  enabled: String(process.env.MC2_SESSION_EMAILS_ENABLED || '').toLowerCase() === 'true',
  missing,
}, null, 2));
if (missing.length) process.exitCode = 1;
