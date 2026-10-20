import { supabaseGet } from './supabase-rest.mjs';

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const toBool = value => value === true || value === 'true' || value === 1 || value === '1';

export function isEs2FeedbackBuyer(row) {
  if (row?.feedback_source === 'mc2') return row.payment_status === 'paid';
  return !row?.refunded_at && (toBool(row?.es_purchased) || toBool(row?.purchased));
}

function missingLegacyPurchaseColumn(result) {
  return !result.ok && ['42703', 'PGRST204'].includes(result.error?.code)
    && JSON.stringify(result.error).includes('es_purchased');
}

/** Read-only identity resolution shared by the gate AND submission.
 * Never creates a legacy registration, updates an entitlement, or sends anything.
 * A verified old token may resolve to the paid MC2 account with the same email;
 * the returned canonical token is then used for both storage and subsequent checks.
 */
export async function resolveEs2FeedbackRegistration({ token, email }, { get = supabaseGet } = {}) {
  token = String(token || '').trim();
  email = normalizeEmail(email);
  if (!token && !email) return { ok: false, status: 400, error: 'Identité requise' };

  const lookup = async (table, identity) => {
    const byToken = Boolean(identity.token);
    const expected = byToken ? identity.token : normalizeEmail(identity.email);
    // Escape LIKE wildcards. The exact comparison below is an additional guard.
    const value = byToken ? expected : expected.replace(/[\\%_*]/g, '\\$&');
    const filter = `${byToken ? 'token=eq' : 'email=ilike'}.${encodeURIComponent(value)}`;
    const legacy = table === 'webinaire_registrations';
    const fields = legacy ? 'token,email,prenom,es_purchased,purchased,refunded_at' : 'token,email,prenom,payment_status';
    let result = await get(`${table}?${filter}&select=${fields}&limit=20`);
    if (legacy && missingLegacyPurchaseColumn(result)) {
      result = await get(`${table}?${filter}&select=token,email,prenom,purchased,refunded_at&limit=20`);
    }
    if (!result.ok) return result;
    if (!Array.isArray(result.data)) return { ok: false, status: 500, error: 'Invalid registration response' };
    const rows = result.data
      .filter(row => byToken ? row.token === expected : normalizeEmail(row.email) === expected)
      .map(row => ({ ...row, feedback_source: legacy ? 'webinaire' : 'mc2' }));
    // Case-only duplicate legacy emails must not hide an actual paid registration.
    return { ...result, data: rows.sort((a, b) => Number(isEs2FeedbackBuyer(b)) - Number(isEs2FeedbackBuyer(a))) };
  };

  const legacy = await lookup('webinaire_registrations', token ? { token } : { email });
  if (!legacy.ok) return legacy;
  const oldRow = legacy.data[0];
  if (oldRow && isEs2FeedbackBuyer(oldRow)) return { ...legacy, data: [oldRow] };

  // Do not accept an arbitrary email alongside an unknown token. Only an existing
  // registration can supply the email used to bridge the two generations.
  const mc2Identity = oldRow?.email ? { email: oldRow.email } : token ? { token } : { email };
  const mc2 = await lookup('mc2_registrations', mc2Identity);
  if (!mc2.ok) return mc2;
  const newRow = mc2.data[0];
  return { ok: true, status: 200, data: newRow ? [newRow] : oldRow ? [oldRow] : [] };
}
