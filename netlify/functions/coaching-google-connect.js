import crypto from 'crypto';
import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';
import { coachingGoogleRedirectUri } from './lib/coaching-google.mjs';

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function publicKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  if (!process.env.GOOGLE_COACHING_CLIENT_ID || !process.env.GOOGLE_COACHING_CLIENT_SECRET || !process.env.COACHING_TOKEN_ENCRYPTION_KEY) return json(503, { error: 'Google Calendar doit encore être configuré.' });
  const authorization = req.headers.get('authorization') || '';
  const key = publicKey();
  if (!authorization.startsWith('Bearer ') || !key || !process.env.SUPABASE_URL) return json(401, { error: 'Reconnecte-toi.' });
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user.id) return json(401, { error: 'Session invalide.' });
  const coachResult = await supabaseGet(`coaching_coaches?auth_user_id=eq.${user.id}&select=id&limit=1`);
  const coach = coachResult.ok && Array.isArray(coachResult.data) ? coachResult.data[0] : null;
  if (!coach) return json(403, { error: 'Compte coach requis.' });
  const state = crypto.randomBytes(32).toString('base64url');
  const stored = await supabasePost('coaching_google_oauth_states', { coach_id: coach.id, token_hash: crypto.createHash('sha256').update(state).digest('hex'), expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  if (!stored.ok) return json(500, { error: 'Connexion Google impossible.' });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_COACHING_CLIENT_ID, redirect_uri: coachingGoogleRedirectUri(), response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'openid email https://www.googleapis.com/auth/calendar', state }).toString();
  return json(200, { url: url.toString() });
};
