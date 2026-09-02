import crypto from 'crypto';
import { supabaseGet, supabasePost, supabasePatch } from './lib/supabase-rest.mjs';
import { validateMc2SessionSelection } from './lib/mc2-session.mjs';
import { mc2OfferExpiresAt, mc2SessionEndsAtIso } from '../../src/lib/mc2-timing.mjs';
import { queueMc2Sms } from './lib/mc2-sms.mjs';
import { queueMc2SessionEmails } from './lib/mc2-session-emails.mjs';
import { upsertWebinaireSubscriber } from './lib/mailerlite-webinaire.mjs';
import {
  mc2RegistrationMetaEvents,
  sendMc2MetaEvents,
} from './lib/mc2-meta-events.mjs';
import {
  excludeWebinarAttendee,
  isMc2ReactivatedNoShow,
  isWebinarBuyerStatus,
  isWebinarRegistrationExclusion,
  replaceWebinarExclusion,
} from './lib/webinaire-exclusions.mjs';

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

function generateToken() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function trim(value, max = 255) {
  const cleaned = String(value || '').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function registrationResponse(row, alreadyRegistered = false, metaEvents = []) {
  return {
    success: true,
    alreadyRegistered,
    token: row.token,
    statut: row.statut || 'partial',
    sessionStartsAt: row.session_starts_at,
    sessionEndsAt: mc2SessionEndsAtIso(row.session_starts_at),
    slotKind: row.slot_kind,
    visitorTimezone: row.visitor_timezone,
    redirectTo: `/mc2/confirmation?t=${encodeURIComponent(row.token)}`,
    ...(metaEvents.length > 0 ? { metaEvents } : {}),
  };
}

function isCompletedMc2Registration(row = {}) {
  return Boolean(row.registration_completed_at)
    || ['registered', 'present'].includes(String(row.statut || '').trim().toLowerCase())
    || isWebinarBuyerStatus(row);
}

async function persistMc2RegistrationExclusion(row, { reactivatedNoShow = false } = {}) {
  if (!row?.email || !isCompletedMc2Registration(row)) return;
  const result = reactivatedNoShow
    ? await replaceWebinarExclusion(row.email, 'inscrit_mc2')
    : await excludeWebinarAttendee(row.email, 'inscrit_mc2');
  if (!result.ok) {
    console.error('MC2 registration exclusion failed:', result.status, result.error);
  }
}

async function deliverRegistrationMetaEvents(req, row, options) {
  const events = mc2RegistrationMetaEvents(row, options);
  if (events.length === 0) return [];
  try {
    await sendMc2MetaEvents({ events, registration: row, req });
  } catch (error) {
    // Meta ne doit jamais bloquer l'inscription MC2.
    console.error('MC2 Meta registration event failed:', error?.message || error);
  }
  return events;
}

async function queueLiveReminder(row) {
  if (!row?.token || !row?.telephone || !row?.sms_consent_at || !row?.session_starts_at) return;
  const result = await queueMc2Sms({
    token: row.token,
    messageType: 'session_live',
    dueAt: row.session_starts_at,
    discriminator: row.session_starts_at,
  });
  if (!result.ok) console.error('MC2 live SMS queue failed:', result.error);
}

async function queueSessionEmails(row) {
  try {
    await queueMc2SessionEmails(row);
  } catch (error) {
    // La file email ne doit jamais bloquer une inscription valide.
    console.error('MC2 session email queue failed:', error?.message || error);
  }
}

async function syncMailerLite(row) {
  const apiKey = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_MC2_REGISTRATIONS;
  if (!apiKey || !groupId || !row?.email || !row?.token) return;
  try {
    await upsertWebinaireSubscriber({
      email: row.email,
      prenom: row.prenom || '',
      telephone: row.telephone || '',
      pays: row.pays || '',
      token: row.token,
      dateOptinMasterclass: row.registered_at || new Date().toISOString(),
      dateWebinaire: row.session_starts_at,
      groupId,
      apiKey,
      extraFields: {
        mc2_session_kind: row.slot_kind === 'jit' ? 'just-in-time' : 'scheduled',
        mc2_session_starts_at: row.session_starts_at || '',
        mc2_visitor_timezone: row.visitor_timezone || 'UTC',
      },
    });
  } catch (error) {
    // MailerLite ne doit jamais empêcher une inscription MC2 valide.
    console.error('MC2 MailerLite sync failed:', error?.message || error);
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || '').trim().toLowerCase().slice(0, 320);
    const prenom = String(body?.prenom || '').trim().slice(0, 120);
    const telephone = trim(body?.telephone, 40);
    const pays = trim(body?.pays, 80);
    const isComplete = Boolean(telephone && pays);
    const smsConsent = body?.sms_consent === true;

    if (!email || !email.includes('@') || !prenom) {
      return jsonResponse(400, { error: 'Paramètres manquants' });
    }

    const selection = validateMc2SessionSelection({
      sessionStartsAt: body?.session_starts_at,
      slotKind: String(body?.slot_kind || '').trim().toLowerCase(),
      visitorTimezone: String(body?.visitor_timezone || '').trim(),
    });
    if (!selection.ok) return jsonResponse(400, { error: selection.error });

    const source = ['meta_ad', 'tiktok_ad', 'instagram_ad'].includes(String(body?.traffic_source || '').trim().toLowerCase())
      ? String(body.traffic_source).trim().toLowerCase()
      : null;
    const nowIso = new Date().toISOString();
    const sessionFields = {
      session_slot_id: trim(body?.creneau, 40) || selection.slotKind,
      slot_kind: selection.slotKind,
      visitor_timezone: selection.visitorTimezone,
      session_starts_at: selection.sessionStartsAt.toISOString(),
      session_ends_at: selection.sessionEndsAt.toISOString(),
      offer_expires_at: mc2OfferExpiresAt(selection.sessionStartsAt).toISOString(),
    };

    const existing = await supabaseGet(
      `mc2_registrations?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    );
    if (!existing.ok) {
      console.error('MC2 registration lookup failed:', existing.status, existing.error);
      return jsonResponse(500, { error: 'Erreur base de données MC2' });
    }

    const existingRow = Array.isArray(existing.data) ? existing.data[0] || null : null;
    const exclusions = await supabaseGet(
      `webinaire_exclusions?email=eq.${encodeURIComponent(email)}&select=email,raison&limit=1`,
    );
    const exclusion = exclusions.ok && Array.isArray(exclusions.data)
      ? exclusions.data[0] || null
      : null;
    const reactivatedNoShow = isMc2ReactivatedNoShow(exclusion?.raison);
    if (existingRow && isWebinarBuyerStatus(existingRow)) {
      return jsonResponse(403, { error: 'excluded', reason: 'excluded', raison: 'acheteur_es' });
    }
    if (exclusion && !reactivatedNoShow && !isWebinarRegistrationExclusion(exclusion.raison)) {
      return jsonResponse(403, { error: 'excluded', reason: 'excluded', raison: exclusion.raison });
    }
    if (existingRow && isCompletedMc2Registration(existingRow)) {
      return jsonResponse(409, registrationResponse(existingRow, true));
    }

    if (exclusion && !existingRow && !reactivatedNoShow) {
      return jsonResponse(403, { error: 'excluded', reason: 'excluded', raison: exclusion.raison });
    }

    const legacy = await supabaseGet(
      `webinaire_registrations?email=eq.${encodeURIComponent(email)}&select=token,statut&limit=1`,
    );
    if (!legacy.ok) return jsonResponse(500, { error: 'Erreur base de données webinaire' });
    if (Array.isArray(legacy.data) && legacy.data.length > 0 && !reactivatedNoShow) {
      return jsonResponse(403, { error: 'excluded', reason: 'excluded', raison: 'inscrit_webinaire' });
    }

    if (existingRow) {
      const row = existingRow;
      const completedBefore = isCompletedMc2Registration(row);
      const patch = {
        prenom,
        ...sessionFields,
        statut: isComplete ? 'registered' : (row.statut || 'partial'),
        telephone: telephone || row.telephone || null,
        pays: pays || row.pays || null,
        registration_completed_at: isComplete ? (row.registration_completed_at || nowIso) : row.registration_completed_at,
        traffic_source: source || row.traffic_source || null,
        utm_source: trim(body?.utm_source) || row.utm_source || null,
        utm_medium: trim(body?.utm_medium) || row.utm_medium || null,
        utm_campaign: trim(body?.utm_campaign) || row.utm_campaign || null,
        utm_content: trim(body?.utm_content) || row.utm_content || null,
        utm_term: trim(body?.utm_term) || row.utm_term || null,
        tt_click_id: trim(body?.tt_click_id) || row.tt_click_id || null,
        tt_event_id: trim(body?.tt_event_id) || row.tt_event_id || null,
        meta_fbc: trim(body?.meta_fbc) || row.meta_fbc || null,
        meta_fbp: trim(body?.meta_fbp) || row.meta_fbp || null,
        meta_event_id: trim(body?.meta_event_id) || row.meta_event_id || null,
        optin_variant: trim(body?.optin_variant, 80) || row.optin_variant || null,
        optin_funnel_id: trim(body?.optin_funnel_id, 80) || row.optin_funnel_id || null,
        sms_consent_at: smsConsent ? (row.sms_consent_at || nowIso) : row.sms_consent_at,
        sms_consent_source: smsConsent ? 'mc2_optin' : row.sms_consent_source,
      };
      const updated = await supabasePatch(
        'mc2_registrations',
        `token=eq.${encodeURIComponent(row.token)}`,
        patch,
      );
      if (!updated.ok) {
        console.error('MC2 registration update failed:', updated.status, updated.error);
        return jsonResponse(500, { error: 'Erreur mise à jour MC2' });
      }
      const completedRow = { ...row, ...patch };
      if (isComplete) await persistMc2RegistrationExclusion(completedRow, { reactivatedNoShow });
      await syncMailerLite(completedRow);
      await queueLiveReminder(completedRow);
      if (isComplete) await queueSessionEmails(completedRow);
      const metaEvents = await deliverRegistrationMetaEvents(req, completedRow, {
        created: false,
        completedNow: isComplete && !completedBefore,
      });
      return jsonResponse(200, registrationResponse(completedRow, true, metaEvents));
    }

    const row = {
      token: generateToken(),
      email,
      prenom,
      telephone,
      pays,
      ...sessionFields,
      statut: isComplete ? 'registered' : 'partial',
      registration_completed_at: isComplete ? nowIso : null,
      traffic_source: source,
      utm_source: trim(body?.utm_source),
      utm_medium: trim(body?.utm_medium),
      utm_campaign: trim(body?.utm_campaign),
      utm_content: trim(body?.utm_content),
      utm_term: trim(body?.utm_term),
      tt_click_id: trim(body?.tt_click_id),
      tt_event_id: trim(body?.tt_event_id),
      meta_fbc: trim(body?.meta_fbc),
      meta_fbp: trim(body?.meta_fbp),
      meta_event_id: trim(body?.meta_event_id),
      optin_variant: trim(body?.optin_variant, 80),
      optin_funnel_id: trim(body?.optin_funnel_id, 80),
      sms_consent_at: smsConsent ? nowIso : null,
      sms_consent_source: smsConsent ? 'mc2_optin' : null,
    };
    const inserted = await supabasePost('mc2_registrations', row, { prefer: 'return=minimal' });
    if (!inserted.ok) {
      console.error('MC2 registration insert failed:', inserted.status, inserted.error);
      return jsonResponse(500, { error: 'Erreur enregistrement MC2' });
    }
    if (isComplete) await persistMc2RegistrationExclusion(row, { reactivatedNoShow });
    await queueLiveReminder(row);
    await syncMailerLite(row);
    if (isComplete) await queueSessionEmails(row);
    const metaEvents = await deliverRegistrationMetaEvents(req, row, {
      created: true,
      completedNow: isComplete,
    });
    return jsonResponse(200, registrationResponse(row, false, metaEvents));
  } catch (error) {
    console.error('register-mc2 error:', error);
    return jsonResponse(500, {
      error: 'Erreur serveur',
      details: process.env.NETLIFY_DEV ? error?.message : undefined,
    });
  }
};
