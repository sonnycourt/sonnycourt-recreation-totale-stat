export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key };
}

export function supabaseHeaders(extra = {}) {
  const { key } = getSupabaseConfig();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** @param {string} path query e.g. "webinaire_registrations?token=eq.x" */
export async function supabaseGet(path) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, data: null, error: 'Supabase non configuré' };
  }
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: supabaseHeaders(),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : data };
}

export async function supabasePost(table, body, { prefer = 'return=representation' } = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, data: null, error: 'Supabase non configuré' };
  }
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: prefer }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : data };
}

export async function supabasePatch(table, query, body) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return { ok: false, status: 500, data: null, error: 'Supabase non configuré' };
  }
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: supabaseHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : data };
}
