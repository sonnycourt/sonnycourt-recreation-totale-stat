import { getSupabaseConfig, supabaseHeaders } from './supabase-rest.mjs';

export async function excludeWebinarAttendee(email, raison) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { ok: false, status: 400, error: 'Email invalide' };
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) return { ok: false, status: 500, error: 'Supabase non configuré' };

  const response = await fetch(
    `${url}/rest/v1/webinaire_exclusions?on_conflict=email`,
    {
      method: 'POST',
      headers: supabaseHeaders({
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      }),
      body: JSON.stringify({
        email: normalizedEmail,
        raison: String(raison || 'participant_webinaire').trim(),
      }),
    },
  );

  return {
    ok: response.ok,
    status: response.status,
    error: response.ok ? null : await response.text(),
  };
}
