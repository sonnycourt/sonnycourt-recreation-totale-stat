import { checkMc2RegistrationPhone } from './lib/mc2-registration-country.mjs';
import { captureMc2ChallengeContact, MC2_CHALLENGE_PATH } from './lib/mc2-challenge-contacts.mjs';

// Anonymous validation remains read-only. Rejected contacts with an identity
// are saved in the dedicated table here. Email-only capture may already exist;
// this endpoint never completes a webinar registration or syncs MailerLite.
export default async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  const body = await req.json().catch(() => ({}));
  const result = checkMc2RegistrationPhone(body?.telephone);
  if (result.reason === 'country_not_available' && (body?.email || body?.prenom)) {
    if (!await captureMc2ChallengeContact(body, result)) {
      return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), { status: 503, headers });
    }
  }
  return new Response(JSON.stringify({ ...result,
    ...(result.reason === 'country_not_available' ? { redirectTo: MC2_CHALLENGE_PATH } : {}),
  }), { headers });
};
