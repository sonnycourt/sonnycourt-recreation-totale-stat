import { supabaseGet, supabasePatch, supabasePost } from './supabase-rest.mjs';

/**
 * @returns {Promise<{ ok: boolean, row: { id: number, password_hash: string | null } | null, error?: string }>}
 */
export async function fetchAdminAuthRow() {
  const r = await supabaseGet('admin_es2_auth?id=eq.1&select=id,password_hash,updated_at');
  if (!r.ok) {
    return { ok: false, row: null, error: typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data) };
  }
  const rows = Array.isArray(r.data) ? r.data : [];
  if (rows.length === 0) {
    return { ok: true, row: null };
  }
  return { ok: true, row: rows[0] };
}

export function needsPasswordSetup(row) {
  if (!row) return true;
  const h = row.password_hash;
  return !h || typeof h !== 'string' || h.length < 10;
}

/**
 * @param {string} passwordHash
 */
export async function savePasswordHash(passwordHash) {
  const existing = await fetchAdminAuthRow();
  const iso = new Date().toISOString();
  const body = { password_hash: passwordHash, updated_at: iso };

  if (existing.ok && existing.row) {
    const patch = await supabasePatch('admin_es2_auth', 'id=eq.1', body);
    if (patch.ok) return { ok: true };
    return { ok: false, error: patch.error };
  }

  const post = await supabasePost('admin_es2_auth', { id: 1, ...body });
  if (post.ok) return { ok: true };
  return { ok: false, error: post.error };
}
