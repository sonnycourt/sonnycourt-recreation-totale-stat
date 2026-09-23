import { getSupabaseConfig, supabaseHeaders } from './supabase-rest.mjs';

export const MC2_CHALLENGE_PATH = '/challenge-transformation-offre/';

export async function captureMc2ChallengeContact(body, phone) {
  if (phone.reason !== 'country_not_available') return false;
  const email = String(body?.email || '').trim().toLowerCase();
  const firstName = String(body?.prenom || '').trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320 || !firstName) return false;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return false;
  const source = ['meta_ad', 'tiktok_ad', 'instagram_ad'].includes(body?.traffic_source) ? body.traffic_source : null;
  const sourcePath = source === 'meta_ad' ? '/meta/mc2/' : source === 'tiktok_ad' ? '/tt/mc2/' : '/mc2/';
  try {
    const response = await fetch(`${url}/rest/v1/mc2_challenge_contacts?on_conflict=email`, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify({
        email, first_name: firstName, telephone: phone.telephone, phone_country: phone.country,
        source_path: sourcePath, traffic_source: source,
        optin_funnel_id: String(body?.optin_funnel_id || '').slice(0, 80) || null,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error('MC2 challenge contact persistence failed:', response.status);
    return response.ok;
  } catch {
    console.error('MC2 challenge contact persistence unavailable');
    return false;
  }
}
