import crypto from 'crypto';
import { supabaseGet, supabasePatch } from './supabase-rest.mjs';
import { coachingAppOrigin } from './coaching-origin.mjs';

function encryptionKey() {
  const raw = process.env.COACHING_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('coaching_encryption_key_missing');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptCoachingSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptCoachingSecret(value) {
  const [version, iv, tag, encrypted] = String(value || '').split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('coaching_secret_invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export async function googleAccessTokenForCoach(coachId) {
  const found = await supabaseGet(`coaching_google_connections?coach_id=eq.${encodeURIComponent(coachId)}&select=coach_id,encrypted_refresh_token,encrypted_access_token,access_expires_at&limit=1`);
  const connection = found.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (!connection) return null;
  if (connection.encrypted_access_token && new Date(connection.access_expires_at).getTime() > Date.now() + 60000) return decryptCoachingSecret(connection.encrypted_access_token);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_COACHING_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_COACHING_CLIENT_SECRET || '',
      refresh_token: decryptCoachingSecret(connection.encrypted_refresh_token),
      grant_type: 'refresh_token',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`google_refresh_${response.status}`);
  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  const stored = await supabasePatch('coaching_google_connections', `coach_id=eq.${encodeURIComponent(coachId)}`, { encrypted_access_token: encryptCoachingSecret(data.access_token), access_expires_at: expiresAt });
  if (!stored.ok || !Array.isArray(stored.data) || !stored.data[0]) throw new Error(`google_refresh_persist_${stored.status}`);
  return data.access_token;
}

export function coachingGoogleRedirectUri(origin = coachingAppOrigin()) {
  return `${String(origin).replace(/\/$/, '')}/.netlify/functions/coaching-google-callback`;
}
