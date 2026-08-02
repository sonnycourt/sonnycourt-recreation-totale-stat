import crypto from 'crypto';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { coachingGoogleRedirectUri, encryptCoachingSecret } from './lib/coaching-google.mjs';

function redirect(origin, result) { return Response.redirect(`${String(origin).replace(/\/$/, '')}/coach-console?google=${result}#settings`, 302); }

export default async (req) => {
  const requestUrl = new URL(req.url);
  const origin = process.env.URL || process.env.DEPLOY_PRIME_URL || requestUrl.origin;
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  if (!code || !state) return redirect(origin, 'error');
  const hash = crypto.createHash('sha256').update(state).digest('hex');
  const now = new Date().toISOString();
  const found = await supabaseGet(`coaching_google_oauth_states?token_hash=eq.${hash}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}&select=id,coach_id&limit=1`);
  const stored = found.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (!stored) return redirect(origin, 'expired');
  await supabasePatch('coaching_google_oauth_states', `id=eq.${stored.id}&used_at=is.null`, { used_at: now });
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_COACHING_CLIENT_ID || '', client_secret: process.env.GOOGLE_COACHING_CLIENT_SECRET || '', redirect_uri: coachingGoogleRedirectUri(origin), grant_type: 'authorization_code' }),
  });
  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokens.refresh_token) return redirect(origin, 'error');
  let googleEmail = null;
  if (tokens.access_token) {
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (profileResponse.ok) googleEmail = (await profileResponse.json()).email || null;
  }
  const upsert = await supabasePost('coaching_google_connections?on_conflict=coach_id', {
    coach_id: stored.coach_id,
    encrypted_refresh_token: encryptCoachingSecret(tokens.refresh_token),
    encrypted_access_token: tokens.access_token ? encryptCoachingSecret(tokens.access_token) : null,
    access_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
    scope: tokens.scope || null,
    google_email: googleEmail,
    updated_at: now,
  }, { prefer: 'resolution=merge-duplicates,return=minimal' });
  if (!upsert.ok) return redirect(origin, 'error');
  await supabasePatch('coaching_coaches', `id=eq.${stored.coach_id}`, { google_calendar_id: 'primary', calendar_connected_at: now });
  return redirect(origin, 'connected');
};
