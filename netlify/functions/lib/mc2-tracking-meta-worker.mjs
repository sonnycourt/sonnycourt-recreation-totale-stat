import { getSupabaseConfig, supabaseHeaders } from './supabase-rest.mjs';
import { sendMetaEvent } from './meta-capi.mjs';

// Delivery has no influence on registration, playback, offer deadlines or payment.
export async function deliverTrackingMeta({ now = Date.now(), send = sendMetaEvent, deployContext = process.env.CONTEXT } = {}) {
  if (deployContext !== 'production') return { skipped: 'non_production' };
  // Scheduled functions have a 30-second ceiling: stop claiming work early.
  const claimUntil = Date.now() + 10000;
  const { url, key } = getSupabaseConfig();
  if (!url || !key || !process.env.META_ACCESS_TOKEN || !process.env.META_PIXEL_ID) return { skipped: 'configuration' };
  const db = async (path, options = {}) => {
    const response = await fetch(`${url}/rest/v1/${path}`, { ...options,
      headers: supabaseHeaders({ Prefer: 'return=representation', ...(options.headers || {}) }), signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('tracking_delivery_storage_' + response.status);
    return response.status === 204 ? [] : response.json();
  };
  const nowIso = new Date(now).toISOString(), expiredLease = new Date(now - 300000).toISOString();
  const rows = await db(`mc2_tracking_meta_outbox?or=(and(status.in.(pending,retry),next_attempt_at.lte.${encodeURIComponent(nowIso)}),and(status.eq.processing,last_attempt_at.lt.${encodeURIComponent(expiredLease)}))&order=next_attempt_at.asc&limit=12`);
  const results = { examined: rows.length, sent: 0, retry: 0, skipped: 0, failed: 0 };
  const queue = [...rows];
  // Four bounded lanes and conditional claims. Uncertain sends reuse the same Meta event ID.
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (queue.length && Date.now() < claimUntil) {
      const row = queue.shift(), filter = `delivery_key=eq.${encodeURIComponent(row.delivery_key)}`;
      const attempts = Number(row.attempts || 0) + 1;
      try {
        const claim = await db(`mc2_tracking_meta_outbox?${filter}&status=eq.${row.status}&attempts=eq.${Number(row.attempts || 0)}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'processing', attempts, last_attempt_at: nowIso }) });
        if (!claim.length) continue;
        const patch = async data => db(`mc2_tracking_meta_outbox?${filter}&status=eq.processing&attempts=eq.${attempts}`, { method: 'PATCH', body: JSON.stringify(data) });
        const [registrations, tests] = await Promise.all([
          db(`mc2_registrations?token=eq.${encodeURIComponent(row.token)}&select=token,email,telephone,traffic_source,meta_fbc,meta_fbp,optin_variant&limit=1`),
          db(`mc2_tracking_test_registrations?token=eq.${encodeURIComponent(row.token)}&select=token&limit=1`),
        ]);
        const registration = registrations[0];
        if (!registration || tests.length || (registration.traffic_source !== 'meta_ad' && row.event_name !== 'OfferViewed')) {
          await patch({ status: 'skipped', last_error: 'test_or_ineligible' }); results.skipped++; continue;
        }
        if (now - Date.parse(row.event_time) > 6 * 86400000 || attempts > 20) {
          await patch({ status: 'failed', last_error: 'delivery_window_or_attempt_limit' }); results.failed++; continue;
        }
        const context = row.context || {};
        const result = await send({ eventName: row.event_name, eventId: row.event_id,
          eventTime: Math.floor(Date.parse(row.event_time) / 1000),
          email: registration.email, phone: registration.telephone, externalId: registration.token,
          fbc: registration.meta_fbc, fbp: registration.meta_fbp,
          ip: context.ip, userAgent: context.userAgent,
          url: 'https://sonnycourt.com' + (context.route === '/mc2/replay/' ? '/mc2/replay/' : '/mc2/session/'),
          contentName: 'Masterclass ES2 — observation v2', optinVariant: registration.optin_variant });
        if (result?.ok && Number(result.response?.events_received) > 0) {
          await patch({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }); results.sent++;
        } else {
          await patch({ status: 'retry', next_attempt_at: new Date(now + Math.min(21600000, 60000 * 2 ** Math.min(attempts, 9))).toISOString(),
            last_error: 'meta_not_acknowledged' }); results.retry++;
        }
      } catch { results.retry++; /* Lease recovery preserves uncertain deliveries. */ }
    }
  }));
  return results;
}
