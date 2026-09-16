import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';
import { summarizeTracking } from './lib/mc2-tracking-report.mjs';
import { OFFER_VERSION } from '../../src/lib/mc2-tracking-contract.mjs';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' } });

export async function readTrackingReport({ from, to, source, slot, now = Date.now() }) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('storage');
  let partial = false;
  const readPages = async (path, cap) => {
    const rows = [];
    for (let offset = 0; offset < cap; offset += 500) {
      const res = await fetch(`${url}/rest/v1/${path}&limit=500&offset=${offset}`, { headers: supabaseHeaders(), signal: AbortSignal.timeout(7000) });
      if (!res.ok) throw new Error('read_failed');
      const page = await res.json();
      if (!Array.isArray(page)) throw new Error('invalid_response');
      rows.push(...page);
      if (page.length < 500) return rows;
    }
    partial = true;
    return rows;
  };
  const fromIso = encodeURIComponent(new Date(from).toISOString()), toIso = encodeURIComponent(new Date(to).toISOString());
  let filter = '';
  if (source === 'meta_ad') filter += '&traffic_source=eq.meta_ad';
  if (source === 'non_attribue') filter += '&traffic_source=is.null';
  if (['jit', 'scheduled'].includes(slot)) filter += '&slot_kind=eq.' + slot;
  const [registrations, tests, events, purchaseEvents, deliveries] = await Promise.all([
    readPages(`mc2_registrations?registration_completed_at=gte.${fromIso}&registration_completed_at=lt.${toIso}${filter}&select=id,token,pays,traffic_source,slot_kind,registration_completed_at,saw_offer&order=id.asc`, 5000),
    readPages('mc2_tracking_test_registrations?select=token&order=token.asc', 5000),
    readPages(`mc2_tracking_events_v2?client_occurred_at=gte.${fromIso}&client_occurred_at=lt.${toIso}&offer_version=eq.${encodeURIComponent(OFFER_VERSION)}&select=event_id,token,event_name,visit_id,route,client_occurred_at,metadata,webinar_version,offer_version&order=received_at.asc,event_id.asc`, 50000),
    readPages(`mc2_funnel_events?occurred_at=gte.${fromIso}&occurred_at=lt.${toIso}&event_name=eq.purchase_completed&metadata->>provider=eq.spiffy&select=token,event_name,occurred_at,metadata&order=id.asc`, 5000),
    readPages(`mc2_tracking_meta_outbox?created_at=gte.${fromIso}&created_at=lt.${toIso}&select=token,event_name,status,attempts,last_error&order=created_at.asc,delivery_key.asc`, 10000),
  ]);
  const included = new Set(registrations.map(r => r.token)), excluded = new Set(tests.map(r => r.token));
  const metaDelivery = { pending: 0, processing: 0, sent: 0, retry: 0, failed: 0, skipped: 0 };
  for (const delivery of deliveries) if (included.has(delivery.token) && !excluded.has(delivery.token) && delivery.status in metaDelivery) metaDelivery[delivery.status]++;
  return { ...summarizeTracking({ registrations, tests, events, purchaseEvents, now, partial }),
    metaDelivery,
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), generatedAt: new Date(now).toISOString(),
    definitions: { cohort: 'Inscriptions finalisées dans la fenêtre choisie ; actions observées dans cette même fenêtre.',
      cta: 'Lecture continue au premier plan au passage de 94:50 live / 74:50 replay.',
      country: 'Pays stocké à l’inscription, pas revenu individuel. Autre reste non classé.',
      commitment: 'Confirmation initiale Spiffy ; ne signifie pas première mensualité encaissée.',
      retention: 'Au moins 1 seconde média observée au premier plan dans la minute ; dédoublonnée par personne.',
      cash: 'Encaissements récurrents non reconstruits depuis les statuts legacy : consulter le registre prestataire.' } };
}
export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'method' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'unauthorized' });
  const params = new URL(req.url).searchParams, now = Date.now();
  const from = Date.parse(params.get('from') || '') || now - 86400000;
  const to = Date.parse(params.get('to') || '') || now;
  if (to <= from || to - from > 7 * 86400000 || to > now + 60000) return json(400, { error: 'Fenêtre de 7 jours maximum.' });
  try { return json(200, await readTrackingReport({ from, to, now, source: params.get('source'), slot: params.get('slot') })); }
  catch { return json(503, { error: 'Mesures indisponibles. Aucun zéro ne remplace une erreur de lecture.' }); }
};
