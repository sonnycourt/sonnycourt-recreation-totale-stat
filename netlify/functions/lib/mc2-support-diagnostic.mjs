const IMPORTANT_EVENTS = new Set([
  'confirmation_viewed',
  'room_join_clicked',
  'session_page_viewed',
  'session_joined',
  'video_checkpoint',
  'cta_reached',
  'cta_clicked',
  'checkout_clicked',
  'checkout_viewed',
  'checkout_actually_seen',
  'checkout_engaged',
  'payment_method_selected',
  'payment_submitted',
  'payment_error',
  'purchase_completed',
]);

const DELIVERED_STATUSES = new Set(['delivered', 'sent', 'succeeded', 'complete', 'completed']);
const PROBLEM_STATUSES = new Set(['retry', 'failed', 'error']);

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function stamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  const parsed = stamp(value);
  return parsed == null ? null : new Date(parsed).toISOString();
}

function clean(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function purchased(row) {
  return Boolean(row?.purchased_at)
    || row?.statut === 'purchased'
    || ['paid', 'succeeded', 'active', 'complete', 'completed']
      .includes(String(row?.payment_status || '').toLowerCase());
}

function normalizeEvent(row) {
  const name = clean(row?.event_name, 64);
  if (!IMPORTANT_EVENTS.has(name)) return null;
  const numericValue = /^\d+$/.test(String(row?.event_value || '').trim())
    ? integer(row.event_value)
    : null;
  return {
    event: name,
    at: iso(row?.occurred_at),
    value: numericValue,
  };
}

function normalizeJob(row, channel) {
  const status = clean(row?.status, 32).toLowerCase();
  return {
    channel,
    type: clean(row?.message_type || row?.segment, 64) || 'inconnu',
    status: status || 'inconnu',
    dueAt: iso(row?.due_at || row?.next_attempt_at),
    deliveredAt: iso(row?.delivered_at || row?.sent_at || row?.succeeded_at),
    lastAttemptAt: iso(row?.last_attempt_at),
    attempts: integer(row?.attempts),
    skipReason: clean(row?.skip_reason, 120) || null,
    hasError: Boolean(clean(row?.last_error, 20)),
  };
}

function latestEvent(events, eventName) {
  return events
    .filter((event) => event.event === eventName && event.at)
    .sort((a, b) => stamp(b.at) - stamp(a.at))[0] || null;
}

function overdueProblem(job, nowMs) {
  if (PROBLEM_STATUSES.has(job.status)) return true;
  const dueMs = stamp(job.dueAt);
  return job.status === 'pending' && dueMs != null && dueMs < nowMs - (15 * 60 * 1000);
}

export function normalizeMc2SupportEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return '';
  return email;
}

export function summarizeMc2SupportDiagnostic({
  registration = null,
  events = [],
  presence = null,
  sessionEmails = [],
  smsJobs = [],
  replayJobs = [],
  warnings = [],
  now = new Date(),
} = {}) {
  if (!registration) {
    return {
      readOnly: true,
      generatedAt: now.toISOString(),
      found: false,
      diagnosis: {
        status: 'not_found',
        headline: 'Aucune inscription MC2 trouvée pour cette adresse.',
        issues: [],
      },
      warnings,
    };
  }

  const normalizedEvents = events
    .map(normalizeEvent)
    .filter(Boolean)
    .sort((a, b) => (stamp(a.at) || 0) - (stamp(b.at) || 0))
    .slice(-120);
  const jobs = [
    ...sessionEmails.map((row) => normalizeJob(row, 'email')),
    ...smsJobs.map((row) => normalizeJob(row, 'sms')),
    ...replayJobs.map((row) => normalizeJob(row, 'replay_email')),
  ].sort((a, b) => (stamp(a.dueAt) || 0) - (stamp(b.dueAt) || 0));

  const nowMs = now.getTime();
  const startsMs = stamp(registration.session_starts_at);
  const endsMs = stamp(registration.session_ends_at);
  const liveWatchSeconds = integer(registration.watch_max_seconds_live);
  const replayWatchSeconds = integer(registration.watch_max_seconds_replay);
  const joinedEvent = latestEvent(normalizedEvents, 'session_joined');
  const sessionPageEvent = latestEvent(normalizedEvents, 'session_page_viewed');
  const checkoutSeenEvent = latestEvent(normalizedEvents, 'checkout_actually_seen')
    || latestEvent(normalizedEvents, 'checkout_viewed');
  const attended = registration.attended_live === true
    || liveWatchSeconds > 0
    || replayWatchSeconds > 0
    || Boolean(joinedEvent);
  const sawOffer = registration.saw_offer === true
    || Boolean(latestEvent(normalizedEvents, 'cta_reached'));
  const checkoutSeen = integer(registration.checkout_view_count) > 0
    || Boolean(checkoutSeenEvent)
    || registration.checkout_engaged === true;
  const paid = purchased(registration);
  const problemJobs = jobs.filter((job) => overdueProblem(job, nowMs));
  const issues = [];

  if (problemJobs.length) {
    issues.push(`${problemJobs.length} communication${problemJobs.length > 1 ? 's' : ''} en échec, en reprise ou en retard.`);
  }
  if (registration.payment_status === 'error' || latestEvent(normalizedEvents, 'payment_error')) {
    issues.push('Une erreur de paiement a été enregistrée.');
  }

  let status = 'healthy';
  let headline = 'Inscription MC2 valide.';
  if (paid) {
    headline = 'Achat confirmé dans MC2.';
  } else if (startsMs != null && nowMs < startsMs) {
    headline = 'Inscription valide : la session n’a pas encore commencé.';
  } else if (attended && sawOffer && checkoutSeen) {
    headline = 'Parcours confirmé jusqu’au checkout, sans achat enregistré.';
  } else if (attended && sawOffer) {
    headline = 'Lecture et exposition à l’offre confirmées, sans checkout réellement vu.';
  } else if (attended) {
    headline = 'Connexion et lecture confirmées avant l’offre.';
  } else if (sessionPageEvent || integer(registration.session_page_view_count) > 0) {
    status = 'attention';
    headline = 'La page de session a été ouverte, mais aucune lecture vidéo n’est confirmée.';
  } else if (endsMs != null && nowMs > endsMs) {
    status = 'attention';
    headline = 'Aucune connexion observée pendant la session : no-show probable.';
  }
  if (issues.length && status === 'healthy') status = 'attention';

  const deliveredCommunications = jobs.filter((job) => DELIVERED_STATUSES.has(job.status)).length;
  return {
    readOnly: true,
    generatedAt: now.toISOString(),
    found: true,
    context: {
      country: clean(registration.pays, 80) || null,
      phoneProvided: Boolean(clean(registration.telephone, 40)),
      timezone: clean(registration.visitor_timezone, 80) || 'UTC',
    },
    registration: {
      status: clean(registration.statut, 32) || null,
      slotKind: clean(registration.slot_kind, 32) || null,
      registeredAt: iso(registration.registration_completed_at || registration.registered_at),
      sessionStartsAt: iso(registration.session_starts_at),
      sessionEndsAt: iso(registration.session_ends_at),
      offerExpiresAt: iso(registration.offer_expires_at),
    },
    journey: {
      sessionPageViews: integer(registration.session_page_view_count),
      lastSessionPageViewAt: sessionPageEvent?.at || null,
      joined: attended,
      joinedAt: iso(registration.session_joined_at) || joinedEvent?.at || null,
      liveWatchSeconds,
      replayWatchSeconds,
      offerSeen: sawOffer,
      offerSeenAt: latestEvent(normalizedEvents, 'cta_reached')?.at || null,
      checkoutSeen,
      checkoutSeenAt: iso(registration.checkout_last_viewed_at) || checkoutSeenEvent?.at || null,
      checkoutEngaged: registration.checkout_engaged === true,
      checkoutPlan: clean(registration.checkout_last_plan, 40) || null,
      paymentMode: clean(registration.checkout_last_payment_mode, 40) || null,
      purchaseConfirmed: paid,
      purchasedAt: iso(registration.purchased_at),
    },
    latestPresence: presence ? {
      stage: clean(presence.stage, 32) || null,
      currentSecond: integer(presence.current_second),
      playing: presence.is_playing === true,
      mode: clean(presence.mode, 16) || null,
      updatedAt: iso(presence.updated_at),
    } : null,
    communications: {
      delivered: deliveredCommunications,
      problems: problemJobs.length,
      jobs,
    },
    timeline: normalizedEvents,
    diagnosis: { status, headline, issues },
    warnings,
  };
}
