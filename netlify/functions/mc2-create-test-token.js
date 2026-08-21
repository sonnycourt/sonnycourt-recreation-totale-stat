import crypto from 'node:crypto';
import { supabasePost } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function authorized(req) {
  const expected = String(process.env.MC2_TEST_TOKEN_ADMIN_SECRET || '').trim();
  const supplied = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  if (!authorized(req)) return json(404, { error: 'Introuvable' });

  try {
    const now = new Date();
    const token = crypto.randomBytes(24).toString('hex');
    const suffix = `${now.getTime()}-${crypto.randomBytes(3).toString('hex')}`;
    const sessionStartsAt = new Date(now.getTime() - 70 * 60 * 1000);
    const sessionEndsAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const offerExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const row = {
      token,
      email: `mc2.stripe.live.test+${suffix}@example.com`,
      prenom: 'Test Stripe',
      pays: 'CH',
      session_slot_id: 'jit-test-stripe',
      slot_kind: 'jit',
      visitor_timezone: 'Europe/Zurich',
      session_starts_at: sessionStartsAt.toISOString(),
      session_ends_at: sessionEndsAt.toISOString(),
      offer_expires_at: offerExpiresAt.toISOString(),
      statut: 'present',
      traffic_source: 'internal_test',
      optin_variant: 'mc2-stripe-live-preview',
      optin_funnel_id: 'internal-test',
      registration_completed_at: now.toISOString(),
      attended_live: true,
      session_joined_at: sessionStartsAt.toISOString(),
      saw_offer: true,
    };
    const inserted = await supabasePost('mc2_registrations', row, { prefer: 'return=minimal' });
    if (!inserted.ok) throw new Error(`mc2_test_registration_${inserted.status}`);
    return json(200, {
      ok: true,
      token,
      expires_at: offerExpiresAt.toISOString(),
      url: `https://sonnycourt.com/mc2/session/?preview=dev&stripe=live&t=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    console.error('mc2-create-test-token:', error);
    return json(500, { error: 'Le token test ne peut pas être créé.' });
  }
};
