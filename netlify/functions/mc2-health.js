import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { getSupabaseConfig, supabaseGet } from './lib/supabase-rest.mjs';
import {
  MC2_HEALTH_THRESHOLDS,
  MC2_PAGE_PROBES,
  overallHealth,
  safeErrorCategory,
  summarizeFunnel,
  summarizePages,
  summarizeQueue,
} from './lib/mc2-health.mjs';

const NETLIFY_DIAGNOSTICS = 'https://app.netlify.com';
const SUPABASE_DIAGNOSTICS = 'https://supabase.com/dashboard';
const STRIPE_DIAGNOSTICS = 'https://dashboard.stripe.com/payments';
const MAILERLITE_DIAGNOSTICS = 'https://dashboard.mailerlite.com';
const CIRCLE_DIAGNOSTICS = 'https://app.circle.so';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function enabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

async function read(path) {
  try {
    return await supabaseGet(path);
  } catch (error) {
    return { ok: false, status: 500, data: null, error: safeErrorCategory(error?.message) };
  }
}

async function probePage(baseUrl, probe) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), MC2_HEALTH_THRESHOLDS.pageTimeoutMs);
  try {
    const response = await fetch(new URL(probe.path, baseUrl), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'SonnyCourt-MC2-Health/1.0',
      },
    });
    const body = await response.text();
    const durationMs = Date.now() - startedAt;
    const markerOk = body.includes(probe.marker);
    const status = response.ok && markerOk
      ? (durationMs > MC2_HEALTH_THRESHOLDS.pageTimeoutMs - 1500 ? 'orange' : 'green')
      : 'red';
    return {
      label: probe.label,
      path: probe.path,
      status,
      httpStatus: response.status,
      durationMs,
      markerOk,
      value: status === 'green' ? `${durationMs} ms` : status === 'orange' ? `${durationMs} ms · lent` : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      label: probe.label,
      path: probe.path,
      status: 'red',
      httpStatus: null,
      durationMs: Date.now() - startedAt,
      markerOk: false,
      value: error?.name === 'AbortError' ? 'Délai dépassé' : 'Injoignable',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeContractJobs(result) {
  if (!result?.ok || !Array.isArray(result.data)) return result;
  return {
    ...result,
    data: result.data.map((row) => ({
      status: row.notification_status,
      due_at: row.notification_due_at,
      attempts: row.notification_attempts,
      last_error: row.notification_last_error,
      last_attempt_at: row.notification_last_attempt_at,
      delivered_at: row.notification_delivered_at,
      updated_at: row.updated_at,
    })),
  };
}

function supabaseComponent(result, now) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return {
      id: 'supabase',
      name: 'Supabase',
      description: 'Base de données et événements du funnel',
      status: 'red',
      affectsOverall: true,
      checkedAt: now.toISOString(),
      summary: 'Configuration absente',
      note: 'La base MC2 ne peut pas être lue.',
      metrics: [{ label: 'Connexion', value: 'Impossible' }],
      items: [],
      diagnosticUrl: SUPABASE_DIAGNOSTICS,
    };
  }
  const ok = result?.ok && Array.isArray(result.data);
  return {
    id: 'supabase',
    name: 'Supabase',
    description: 'Base de données et événements du funnel',
    status: ok ? 'green' : 'red',
    affectsOverall: true,
    checkedAt: now.toISOString(),
    summary: ok ? 'Lecture opérationnelle' : 'Lecture impossible',
    note: ok ? 'Le cockpit a lu la source MC2 sans effectuer aucune écriture.' : 'Les inscriptions MC2 sont inaccessibles au contrôle.',
    metrics: [{ label: 'Lecture', value: ok ? 'OK' : 'Erreur' }],
    items: [],
    diagnosticUrl: SUPABASE_DIAGNOSTICS,
  };
}

function stripeComponent({ registrationsResult, webhooksResult, now }) {
  const checkoutEnabled = enabled('MC2_CHECKOUT_ENABLED');
  const missing = [
    configured('STRIPE_MC2_SECRET_KEY') || configured('STRIPE_SECRET_KEY') ? null : 'clé privée',
    configured('STRIPE_MC2_PUBLISHABLE_KEY') || configured('STRIPE_PUBLISHABLE_KEY') ? null : 'clé publique',
    configured('MC2_STRIPE_INSTALLMENT_PRICE_ID') ? null : 'prix des échéances',
  ].filter(Boolean);
  const rows = registrationsResult?.ok && Array.isArray(registrationsResult.data) ? registrationsResult.data : [];
  const webhooks = webhooksResult?.ok && Array.isArray(webhooksResult.data) ? webhooksResult.data : [];
  const checkouts = rows.filter((row) => row.checkout_clicked || row.checkout_engaged || Number(row.checkout_view_count || 0) > 0).length;
  const purchases = rows.filter((row) => row.purchased_at || row.statut === 'purchased').length;
  const lastWebhook = webhooks.map((row) => Date.parse(row.processed_at || '')).filter(Number.isFinite).sort((a, b) => b - a)[0];
  let status = 'green';
  let summary = 'Paiement prêt';
  let note = 'Configuration vérifiée et journal de webhooks lisible. Aucun paiement test n’est déclenché.';
  if (!checkoutEnabled || missing.length) {
    status = 'red';
    summary = !checkoutEnabled ? 'Checkout désactivé' : 'Configuration incomplète';
    note = !checkoutEnabled ? 'Le point d’entrée Stripe MC2 refuse actuellement les checkouts.' : `Élément${missing.length > 1 ? 's' : ''} manquant${missing.length > 1 ? 's' : ''} : ${missing.join(', ')}.`;
  } else if (!webhooksResult?.ok) {
    status = 'unknown';
    summary = 'Journal Stripe indisponible';
    note = 'La configuration est présente, mais le dernier traitement webhook ne peut pas être confirmé.';
  } else if (!webhooks.length && !checkouts && !purchases) {
    status = 'unknown';
    summary = 'Aucune activité observable';
    note = 'La configuration est présente, mais aucun checkout ni webhook ne permet encore de confirmer le flux réel.';
  }
  return {
    id: 'stripe',
    name: 'Stripe',
    description: 'Checkout, paiements et webhooks MC2',
    status,
    affectsOverall: true,
    checkedAt: now.toISOString(),
    lastRunAt: Number.isFinite(lastWebhook) ? new Date(lastWebhook).toISOString() : null,
    summary,
    note,
    metrics: [
      { label: 'Checkouts 24 h', value: checkouts },
      { label: 'Achats 24 h', value: purchases },
      { label: 'Webhooks lus', value: webhooks.length },
    ],
    items: [],
    diagnosticUrl: STRIPE_DIAGNOSTICS,
  };
}

function mailerLiteComponent({ sessionEmailsResult, replayResult, dunningResult, contractResult, now }) {
  const apiConfigured = configured('MAILERLITE_API_KEY');
  const registrationGroupConfigured = configured('MAILERLITE_GROUP_MC2_REGISTRATIONS');
  const results = [sessionEmailsResult, replayResult, dunningResult, contractResult]
    .filter((result) => result?.ok && Array.isArray(result.data));
  const allRows = results.flatMap((result) => result.data);
  const delivered = allRows.filter((row) => ['sent', 'delivered', 'succeeded'].includes(String(row.status || ''))).length;
  const latest = allRows
    .flatMap((row) => [row.sent_at, row.delivered_at, row.succeeded_at, row.last_attempt_at])
    .map((value) => Date.parse(value || ''))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  let status = 'green';
  let summary = 'Configuration présente';
  let note = delivered
    ? 'Une activité de livraison récente est visible dans les files MC2.'
    : 'Aucune livraison n’est nécessairement attendue sans inscription ; les files détaillées restent la source de vérité.';
  if (!apiConfigured || !registrationGroupConfigured) {
    status = 'red';
    summary = 'Configuration incomplète';
    note = 'La clé MailerLite ou le groupe d’inscription MC2 manque.';
  } else if (!results.length) {
    status = 'unknown';
    summary = 'Activité non vérifiable';
    note = 'La configuration existe, mais aucune file MailerLite ne peut être lue.';
  } else if (!allRows.length) {
    status = 'unknown';
    summary = 'Aucune livraison observable';
    note = 'La configuration existe, mais aucune exécution enregistrée ne permet encore de confirmer une livraison saine.';
  }
  return {
    id: 'mailerlite',
    name: 'MailerLite',
    description: 'Inscription, confirmations, replay et relances',
    status,
    affectsOverall: true,
    checkedAt: now.toISOString(),
    lastRunAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null,
    summary,
    note,
    metrics: [
      { label: 'Livraisons visibles', value: delivered },
      { label: 'Files lisibles', value: results.length },
    ],
    items: [],
    diagnosticUrl: MAILERLITE_DIAGNOSTICS,
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });

  const now = new Date();
  const since = new Date(now.getTime() - MC2_HEALTH_THRESHOLDS.flowWindowHours * 3_600_000).toISOString();
  const requestUrl = new URL(req.url);
  const configuredOrigin = String(process.env.MC2_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '');
  const pageBase = configuredOrigin || (process.env.NETLIFY_DEV ? requestUrl.origin : 'https://sonnycourt.com');

  const [
    pageResults,
    registrationsResult,
    optinsResult,
    presenceResult,
    webhooksResult,
    smsResult,
    sessionEmailsResult,
    replayResult,
    dunningResult,
    circleResult,
    contractRawResult,
    collectionResult,
  ] = await Promise.all([
    Promise.all(MC2_PAGE_PROBES.map((probe) => probePage(pageBase, probe))),
    read(`mc2_registrations?registered_at=gte.${encodeURIComponent(since)}&select=statut,slot_kind,session_starts_at,registration_completed_at,attended_live,watch_max_seconds_live,saw_offer,clicked_cta,checkout_clicked,checkout_engaged,checkout_view_count,payment_status,purchased_at,registered_at,updated_at,last_event_at&order=registered_at.desc&limit=2000`),
    read(`mc2_optin_events?occurred_at=gte.${encodeURIComponent(since)}&select=funnel_id,event_name,occurred_at&order=occurred_at.desc&limit=4000`),
    read('mc2_presence?select=stage,is_playing,updated_at&order=updated_at.desc&limit=1000'),
    read(`mc2_stripe_webhook_events?processed_at=gte.${encodeURIComponent(since)}&select=event_type,livemode,processed_at&order=processed_at.desc&limit=500`),
    read('mc2_sms_jobs?select=status,due_at,attempts,last_error,last_attempt_at,sent_at,updated_at&order=updated_at.desc&limit=1000'),
    read('mc2_session_email_jobs?select=status,due_at,attempts,last_error,last_attempt_at,delivered_at,updated_at&order=updated_at.desc&limit=1000'),
    read('mc2_replay_recovery_jobs?select=message_type,status,due_at,attempts,last_error,last_attempt_at,delivered_at,updated_at&order=updated_at.desc&limit=1000'),
    read('mc2_dunning_jobs?select=status,due_at,attempts,last_error,last_attempt_at,sent_at,updated_at&order=updated_at.desc&limit=1000'),
    read('mc2_circle_onboarding_jobs?select=status,next_attempt_at,attempts,last_error,last_attempt_at,succeeded_at,failed_at,updated_at&order=updated_at.desc&limit=1000'),
    read('mc2_contract_documents?select=notification_status,notification_due_at,notification_attempts,notification_last_error,notification_last_attempt_at,notification_delivered_at,updated_at&order=updated_at.desc&limit=1000'),
    read('mc2_collection_case_jobs?select=status,due_at,attempts,last_error,last_attempt_at,completed_at,updated_at&order=updated_at.desc&limit=1000'),
  ]);
  const contractResult = normalizeContractJobs(contractRawResult);

  const components = [
    summarizePages(pageResults, now),
    supabaseComponent(registrationsResult, now),
    summarizeFunnel({ registrationsResult, optinsResult, presenceResult, now }),
    stripeComponent({ registrationsResult, webhooksResult, now }),
  ];

  components.push(
    summarizeQueue({
      id: 'sms', name: 'SMS', description: 'Rappels live et échéance individuelle',
      enabled: enabled('MC2_SMS_ENABLED'), configured: configured('GATEWAYAPI_TOKEN'), result: smsResult, now,
      affectsOverall: enabled('MC2_SMS_ENABLED'), diagnosticUrl: NETLIFY_DIAGNOSTICS,
    }),
    mailerLiteComponent({ sessionEmailsResult, replayResult, dunningResult, contractResult, now }),
    summarizeQueue({
      id: 'emails', name: 'Emails de session', description: 'Confirmation et rappel H−1',
      enabled: enabled('MC2_SESSION_EMAILS_ENABLED'), configured: configured('MAILERLITE_API_KEY'), result: sessionEmailsResult, now,
      affectsOverall: enabled('MC2_SESSION_EMAILS_ENABLED'), diagnosticUrl: MAILERLITE_DIAGNOSTICS,
    }),
    summarizeQueue({
      id: 'replay', name: 'Replay', description: 'No-show, départ avant CTA et offre vue',
      enabled: enabled('MC2_REPLAY_RECOVERY_ENABLED'), configured: configured('MAILERLITE_API_KEY'), result: replayResult, now,
      affectsOverall: enabled('MC2_REPLAY_RECOVERY_ENABLED'), diagnosticUrl: MAILERLITE_DIAGNOSTICS,
      successStatuses: ['delivered'],
    }),
    summarizeQueue({
      id: 'dunning', name: 'Impayés', description: 'Relances d’échéances Stripe',
      enabled: enabled('MC2_DUNNING_ENABLED'), configured: configured('MAILERLITE_API_KEY'), result: dunningResult, now,
      affectsOverall: enabled('MC2_DUNNING_ENABLED'), diagnosticUrl: STRIPE_DIAGNOSTICS,
    }),
    summarizeQueue({
      id: 'circle', name: 'Circle', description: 'Invitation et tag après achat',
      enabled: enabled('MC2_CIRCLE_ENABLED'), configured: configured('CIRCLE_ADMIN_API_TOKEN'), result: circleResult, now,
      dueField: 'next_attempt_at', affectsOverall: enabled('MC2_CIRCLE_ENABLED'), diagnosticUrl: CIRCLE_DIAGNOSTICS,
      successStatuses: ['succeeded'],
    }),
    summarizeQueue({
      id: 'contracts', name: 'Documents', description: 'Confirmation contractuelle après achat',
      enabled: enabled('MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED'), configured: configured('MAILERLITE_API_KEY'), result: contractResult, now,
      affectsOverall: enabled('MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED'), diagnosticUrl: MAILERLITE_DIAGNOSTICS,
      successStatuses: ['delivered'],
    }),
    summarizeQueue({
      id: 'collection', name: 'Recouvrement', description: 'Préparation locale après cinq reprises',
      enabled: enabled('MC2_COLLECTION_CASES_ENABLED'), configured: true, result: collectionResult, now,
      affectsOverall: enabled('MC2_COLLECTION_CASES_ENABLED'), diagnosticUrl: NETLIFY_DIAGNOSTICS,
      successStatuses: ['completed'], hardFailureStatuses: ['failed'],
    }),
  );

  return json(200, {
    generatedAt: now.toISOString(),
    refreshSeconds: MC2_HEALTH_THRESHOLDS.refreshSeconds,
    readOnly: true,
    personalDataIncluded: false,
    overall: overallHealth(components, now),
    components,
    thresholds: [
      `Pages : rouge si HTTP/marqueur échoue ; orange au-delà de ${MC2_HEALTH_THRESHOLDS.pageTimeoutMs - 1500} ms.`,
      `Files : orange après ${MC2_HEALTH_THRESHOLDS.queueGraceMinutes} min ; rouge dès ${MC2_HEALTH_THRESHOLDS.queueRedCount} jobs, un échec définitif ou ${MC2_HEALTH_THRESHOLDS.queueRedAgeMinutes} min.`,
      `Flux : rouge avec ${MC2_HEALTH_THRESHOLDS.optinsMinimum}+ opt-ins sans inscription, ou ${MC2_HEALTH_THRESHOLDS.maturedRegistrationsMinimum}+ sessions échues sans présence.`,
      'Sans donnée ou avec une automatisation désactivée, l’état est Inconnu — jamais Vert.',
    ],
  });
};
