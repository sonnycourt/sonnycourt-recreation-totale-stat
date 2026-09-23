import { checkMc2RegistrationPhone } from './lib/mc2-registration-country.mjs';

// Pure validation: no database mutation, messaging, or payment calls.
export default async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  const body = await req.json().catch(() => ({}));
  return new Response(JSON.stringify(checkMc2RegistrationPhone(body?.telephone)), { headers });
};
