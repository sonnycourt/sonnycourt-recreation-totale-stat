const required = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MAILERLITE_API_KEY',
  'MAILERLITE_GROUP_MC2_CONFIRMATION', 'MAILERLITE_GROUP_MC2_SESSION_REMINDER_1H',
  'MAILERLITE_GROUP_MC2_OFFER_FOLLOWUP_90M',
  'MAILERLITE_GROUP_MC2_OFFER_CONSULTATIONS_12H',
  'MAILERLITE_GROUP_MC2_OFFER_PROOF_36H',
  'MAILERLITE_GROUP_MC2_OFFER_4H', 'MAILERLITE_GROUP_MC2_OFFER_1H',
  'MAILERLITE_GROUP_MC2_OFFER_5_PLACES',
];
const missing = required.filter((name) => !String(process.env[name] || '').trim());
console.log(JSON.stringify({
  ready: missing.length === 0,
  enabled: String(process.env.MC2_SESSION_EMAILS_ENABLED || '').toLowerCase() === 'true',
  offerEmailsEnabled: String(process.env.MC2_OFFER_EMAILS_ENABLED || '').toLowerCase() === 'true',
  missing,
}, null, 2));
if (missing.length) process.exitCode = 1;
