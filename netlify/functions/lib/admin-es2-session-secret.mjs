import crypto from 'node:crypto';
import { getSupabaseConfig } from './supabase-rest.mjs';

/** Secret de cookie dérivé de la service role (aucune variable Netlify dédiée). */
export function getAdminEs2CookieSecret() {
  const { key } = getSupabaseConfig();
  if (!key || typeof key !== 'string') return '';
  return crypto.createHash('sha256').update(`admin-es2-cookie|${key}`).digest('hex');
}
