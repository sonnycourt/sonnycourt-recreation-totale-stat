import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';
import { ensureMc2OfferDeadline } from './lib/mc2-offer-deadline.mjs';
import { excludeWebinarAttendee } from './lib/webinaire-exclusions.mjs';
import {
  mc2FunnelMetaEvents,
  sendMc2MetaEvents,
} from './lib/mc2-meta-events.mjs';

const ALLOWED_EVENTS = new Set([
  'confirmation_viewed',
  'workbook_opened',
  'calendar_downloaded',
  'room_join_clicked',
  'session_page_viewed',
  'session_joined',
  'video_checkpoint',
  'cta_reached',
  'cta_clicked',
  'auto_redirect_to_offer',
  'invitation_visited',
  'sales_scroll',
  'sales_section_viewed',
  'checkout_clicked',
  'checkout_viewed',
  'checkout_actually_seen',
  'checkout_engaged',
  'stripe_element_ready',
  'payment_details_started',
  'payment_details_completed',
  'terms_accepted',
  'terms_unchecked',
  'wallet_available',
  'wallet_selected',
  'payment_confirmation_started',
  'payment_authentication_outcome',
  'checkout_abandoned',
  'payment_submitted',
  'payment_error',
  'purchase_completed',
  'replay_started',
  'video_freeze_recovery',
]);

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function positiveInt(value, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, Math.floor(number))) : 0;
}

function clean(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sanitizeMeta(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const [key, limit] of Object.entries({
    page_path: 240,
    route: 240,
    button_id: 100,
    section: 64,
    plan: 24,
    payment_mode: 80,
    referrer: 240,
    visit_id: 100,
    slot_kind: 24,
    element_state: 32,
    payment_method: 32,
    error_type: 64,
    error_code: 100,
    decline_code: 100,
    intent_status: 48,
    authentication_state: 32,
    authentication_result: 48,
    authentication_flow: 48,
    authentication_reason: 100,
    last_stage: 64,
    offer_event_id: 255,
  })) {
    const text = clean(input[key], limit);
    if (text) output[key] = text;
  }
  if (input.percent != null) output.percent = positiveInt(input.percent, 100);
  if (input.duration_seconds != null) output.duration_seconds = positiveInt(input.duration_seconds, 86400);
  if (input.active_seconds != null) output.active_seconds = positiveInt(input.active_seconds, 86400);
  if (input.viewport_width != null) output.viewport_width = positiveInt(input.viewport_width, 10000);
  if (input.viewport_height != null) output.viewport_height = positiveInt(input.viewport_height, 10000);
  if (typeof input.checkout_enabled === 'boolean') output.checkout_enabled = input.checkout_enabled;
  if (typeof input.fullscreen === 'boolean') output.fullscreen = input.fullscreen;
  if (typeof input.stripe_ready === 'boolean') output.stripe_ready = input.stripe_ready;
  if (typeof input.payment_details_started === 'boolean') output.payment_details_started = input.payment_details_started;
  if (typeof input.payment_details_complete === 'boolean') output.payment_details_complete = input.payment_details_complete;
  if (typeof input.terms_checked === 'boolean') output.terms_checked = input.terms_checked;
  return output;
}

function dedupeKey(eventName, value, meta) {
  if (eventName === 'video_checkpoint') return `video_checkpoint_${positiveInt(value, 999)}`;
  if (eventName === 'sales_scroll') return `sales_scroll_${positiveInt(meta.percent, 100)}`;
  if (eventName === 'sales_section_viewed' && meta.section) return `sales_section_${meta.section}`;
  if (eventName === 'checkout_engaged' && (meta.visit_id || meta.route)) {
    return `checkout_engaged_${clean(meta.visit_id || meta.route, 100)}`;
  }
  if ([
    'stripe_element_ready',
    'payment_details_started',
    'payment_details_completed',
    'terms_accepted',
    'wallet_available',
    'wallet_selected',
    'payment_confirmation_started',
    'payment_authentication_outcome',
    'checkout_abandoned',
  ].includes(eventName) && meta.visit_id) {
    const suffix = eventName === 'payment_authentication_outcome'
      ? `_${clean(meta.authentication_result || meta.authentication_state || 'unknown', 48)}`
      : '';
    return `${eventName}_${clean(meta.visit_id, 100)}${suffix}`;
  }
  if (['confirmation_viewed', 'workbook_opened', 'calendar_downloaded', 'session_joined', 'cta_reached', 'checkout_actually_seen'].includes(eventName)) {
    return eventName;
  }
  return null;
}

function buildPatch(eventName, value, meta, row) {
  const nowIso = new Date().toISOString();
  const patch = { last_event_at: nowIso };
  if (eventName === 'confirmation_viewed') patch.confirmation_view_count = positiveInt(row.confirmation_view_count) + 1;
  if (eventName === 'workbook_opened') patch.workbook_opened = true;
  if (eventName === 'calendar_downloaded') patch.calendar_downloaded = true;
  if (eventName === 'room_join_clicked') patch.room_click_count = positiveInt(row.room_click_count) + 1;
  if (eventName === 'session_page_viewed') patch.session_page_view_count = positiveInt(row.session_page_view_count) + 1;
  if (eventName === 'session_joined') {
    patch.attended_live = true;
    patch.session_joined_at = row.session_joined_at || nowIso;
    patch.statut = row.statut === 'purchased' ? 'purchased' : 'present';
  }
  if (eventName === 'video_checkpoint') patch.watch_max_minutes = Math.max(positiveInt(row.watch_max_minutes), positiveInt(value, 999));
  if (eventName === 'cta_reached') patch.saw_offer = true;
  if (eventName === 'cta_clicked') {
    patch.clicked_cta = true;
    patch.cta_clicked_at = nowIso;
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'invitation_visited') {
    patch.visited_sales = true;
    patch.sales_visit_count = positiveInt(row.sales_visit_count) + 1;
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'sales_scroll') {
    patch.sales_max_scroll_pct = Math.max(positiveInt(row.sales_max_scroll_pct, 100), positiveInt(meta.percent, 100));
  }
  if (eventName === 'sales_section_viewed') {
    if (meta.section === 'pricing') patch.sales_pricing_viewed = true;
    if (meta.section === 'guarantee') patch.sales_guarantee_viewed = true;
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'checkout_clicked') {
    patch.checkout_clicked = true;
    patch.clicked_cta = true;
    patch.checkout_click_count = positiveInt(row.checkout_click_count) + 1;
    patch.checkout_last_clicked_at = nowIso;
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'checkout_viewed') {
    patch.checkout_view_count = positiveInt(row.checkout_view_count) + 1;
    patch.checkout_last_viewed_at = nowIso;
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'checkout_engaged') {
    patch.checkout_engaged = true;
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'payment_submitted') {
    patch.payment_status = row.payment_status === 'paid' ? 'paid' : 'submitted';
    patch.last_intent_at = nowIso;
  }
  if (eventName === 'payment_error') patch.payment_status = row.payment_status === 'paid' ? 'paid' : 'error';
  if (eventName === 'purchase_completed') {
    patch.payment_status = 'paid';
    patch.statut = 'purchased';
    patch.purchased_at = row.purchased_at || nowIso;
  }
  if (meta.plan) patch.checkout_last_plan = meta.plan;
  if (meta.payment_mode) patch.checkout_last_payment_mode = meta.payment_mode;
  if (meta.button_id) patch.checkout_last_button = meta.button_id;
  if (meta.route || meta.page_path) patch.checkout_last_route = meta.route || meta.page_path;
  return patch;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const token = clean(body?.token, 128);
    const eventName = clean(body?.event, 64);
    if (!token) return jsonResponse(400, { error: 'Token manquant' });
    if (!ALLOWED_EVENTS.has(eventName)) return jsonResponse(400, { error: 'Event invalide' });

    const registration = await supabaseGet(`mc2_registrations?token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
    if (!registration.ok) return jsonResponse(500, { error: 'Erreur lecture MC2' });
    if (!Array.isArray(registration.data) || registration.data.length === 0) {
      return jsonResponse(404, { error: 'Token inconnu' });
    }

    const row = registration.data[0];
    const meta = sanitizeMeta(body?.meta);
    const metaEvents = mc2FunnelMetaEvents({
      eventName,
      value: body?.value,
      meta,
      registration: row,
    });
    const browserMetaEvents = meta.offer_event_id
      ? metaEvents.filter((event) => event.eventId === meta.offer_event_id)
      : [];
    let offerDeadline = null;
    if (eventName === 'cta_reached') {
      offerDeadline = await ensureMc2OfferDeadline({ token, registration: row, source: 'live' });
      if (!offerDeadline.ok) return jsonResponse(500, { error: 'Expiration de l’offre non initialisée' });
    }
    const patch = buildPatch(eventName, body?.value, meta, row);
    const updated = await supabasePatch('mc2_registrations', `token=eq.${encodeURIComponent(token)}`, patch);
    if (!updated.ok) return jsonResponse(500, { error: 'Erreur mise à jour MC2' });

    if (eventName === 'session_joined') {
      const exclusion = await excludeWebinarAttendee(row.email, 'participant_mc2');
      if (!exclusion.ok) {
        console.error('MC2 attendee exclusion failed:', exclusion.status, exclusion.error);
      }
    }

    const event = {
      token,
      event_name: eventName,
      event_value: body?.value == null ? null : clean(body.value, 500),
      page_path: meta.page_path || null,
      metadata: meta,
      dedupe_key: dedupeKey(eventName, body?.value, meta),
    };
    const inserted = await supabasePost('mc2_funnel_events', event, { prefer: 'return=minimal' });
    if (!inserted.ok && inserted.status !== 409) {
      console.error('track-mc2-event insert:', inserted.status, inserted.error);
    }
    if (metaEvents.length > 0) {
      try {
        await sendMc2MetaEvents({
          events: metaEvents,
          registration: row,
          req,
          pagePath: meta.page_path,
        });
      } catch (error) {
        // Le tracking Meta ne doit jamais altérer le parcours MC2.
        console.error('MC2 Meta funnel event failed:', error?.message || error);
      }
    }
    return jsonResponse(200, {
      ok: true,
      ...(browserMetaEvents.length > 0 ? { metaEvents: browserMetaEvents } : {}),
      ...(offerDeadline ? {
        offer_activated_at: offerDeadline.activatedAt,
        offer_expires_at: offerDeadline.offerExpiresAt,
        offer_sms_due_at: offerDeadline.smsDueAt,
        offer_sms_queued: offerDeadline.smsQueued,
      } : {}),
    });
  } catch (error) {
    console.error('track-mc2-event error:', error);
    return jsonResponse(500, { error: 'Erreur serveur' });
  }
};
