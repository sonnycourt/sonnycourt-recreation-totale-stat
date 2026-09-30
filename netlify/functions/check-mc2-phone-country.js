import { checkMc2RegistrationPhone } from './lib/mc2-registration-country.mjs';

// Read-only phone validation for the free masterclass, regardless of country.
export default async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  const body = await req.json().catch(() => ({}));
  const result = checkMc2RegistrationPhone(body?.telephone);
  return new Response(JSON.stringify(result), { headers });
};
