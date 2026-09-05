import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  mc2ReplayRecoveryConfig,
  mc2ReplayRecoveryEnabled,
  processMc2ReplayRecoveryJob,
  queueMc2ReplayRecoveryBatch,
} from './lib/mc2-replay-recovery.mjs';
import { scheduledJson } from './lib/scheduled-response.mjs';
import { MC2_OFFER_DURATION_MS } from '../../src/lib/mc2-timing.mjs';

const DUE_JOB_LIMIT = 20;
const DUE_JOB_CONCURRENCY = 5;
const MAILERLITE_JOB_TIMEOUT_MS = 10_000;
const QUEUE_SCAN_BUDGET_MS = 45_000;
const REPLAY_MESSAGE_TYPES = [
  'no_show_initial',
  'left_before_cta_initial',
  'replay_24h',
  'replay_4h',
];

async function loadCandidates(now) {
  // Une requête unique plafonnée aurait ignoré les nouveaux inscrits dès que
  // le volume dépasse 500. Les tranches journalières couvrent sept jours sans
  // pagination fragile et la clé job absorbe les rares doublons de frontière.
  const dailyLoads = [];
  for (let day = 0; day < 7; day += 1) {
    const upper = new Date(now.getTime() - day * 24 * 60 * 60_000);
    const lower = new Date(upper.getTime() - 24 * 60 * 60_000);
    dailyLoads.push(supabaseGet(
      `mc2_registrations?session_starts_at=lte.${encodeURIComponent(upper.toISOString())}`
        + `&session_starts_at=gt.${encodeURIComponent(lower.toISOString())}`
        + '&statut=not.in.(purchased,expired)'
        + '&or=(payment_status.is.null,payment_status.not.in.(paid,succeeded,active,complete,completed))'
        + '&select=token,email,prenom,visitor_timezone,session_starts_at,session_ends_at,offer_expires_at,attended_live,saw_offer,watch_max_seconds_live,last_presence_at,statut,payment_status,purchased_at'
        + '&order=session_starts_at.asc&limit=1000',
    ));
  }
  const results = await Promise.all(dailyLoads);
  const rows = [];
  for (const result of results) {
    if (!result.ok) throw new Error(`mc2_recovery_candidates_${result.status}`);
    rows.push(...(result.data || []));
  }
  return rows;
}

async function processDueJobs(now) {
  const staleCutoff = new Date(now.getTime() - 5 * 60_000).toISOString();
  await supabasePatch(
    'mc2_replay_recovery_jobs',
    `status=eq.processing&last_attempt_at=lt.${encodeURIComponent(staleCutoff)}`,
    { status: 'retry', last_error: 'processing_timeout' },
  );

  // Les rappels dont le replay est déjà fermé ne doivent jamais bloquer les
  // communications encore utiles. Une seule mise à jour absorbe le backlog
  // historique au lieu de le retraiter ligne par ligne.
  const replayExpiredCutoff = new Date(now.getTime() - MC2_OFFER_DURATION_MS).toISOString();
  const expired = await supabasePatch(
    'mc2_replay_recovery_jobs',
    `status=in.(pending,retry)&message_type=in.(${REPLAY_MESSAGE_TYPES.join(',')})`
      + `&session_starts_at=lte.${encodeURIComponent(replayExpiredCutoff)}`,
    { status: 'skipped', skip_reason: 'replay_expired', last_error: null },
  );
  if (!expired.ok) throw new Error(`mc2_recovery_expired_cleanup_${expired.status}`);

  const jobs = await supabaseGet(
    `mc2_replay_recovery_jobs?status=in.(pending,retry)&due_at=lte.${encodeURIComponent(now.toISOString())}`
      + `&select=*&order=due_at.desc&limit=${DUE_JOB_LIMIT}`,
  );
  if (!jobs.ok) throw new Error(`mc2_recovery_jobs_${jobs.status}`);
  const dueJobs = jobs.data || [];
  const results = new Array(dueJobs.length);
  let cursor = 0;
  const concurrency = Math.min(DUE_JOB_CONCURRENCY, dueJobs.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < dueJobs.length) {
      const index = cursor;
      cursor += 1;
      const job = dueJobs[index];
      results[index] = {
        id: job.id,
        ...(await processMc2ReplayRecoveryJob(job, now, process.env, {
          // Une API externe ralentie produit un retry propre au lieu de retenir
          // toute la fonction jusqu'au timeout global Netlify.
          mailerLiteSignal: AbortSignal.timeout(MAILERLITE_JOB_TIMEOUT_MS),
        })),
      };
    }
  }));
  return {
    results,
    expired: Array.isArray(expired.data) ? expired.data.length : 0,
  };
}

export default async () => {
  if (!mc2ReplayRecoveryEnabled()) {
    return scheduledJson({ ok: true, enabled: false, queued: 0, processed: 0 });
  }

  const now = new Date();
  const startedAt = Date.now();
  mc2ReplayRecoveryConfig();

  // Priorité absolue aux communications déjà dues. Même si la reconstruction
  // de la file devait rencontrer un problème, un email prêt ne reste plus
  // bloqué derrière le balayage historique.
  const due = await processDueJobs(now);

  // Si MailerLite a consommé l'essentiel de la fenêtre, on répond proprement.
  // Le balayage des futurs jobs reprendra au passage suivant, sans retarder les
  // emails déjà dus et sans transformer l'exécution en timeout opaque.
  if (Date.now() - startedAt >= QUEUE_SCAN_BUDGET_MS) {
    return scheduledJson({
      ok: true,
      enabled: true,
      queued: 0,
      queueDeferred: true,
      expired: due.expired,
      processed: due.results.length,
      results: due.results,
    });
  }

  // On programme les jobs dès que la session a commencé ; `due_at` porte le
  // vrai délai de chaque segment. Une fenêtre glissante empêche les anciennes
  // inscriptions déjà traitées de monopoliser la limite PostgREST.
  const candidates = await loadCandidates(now);
  const queued = await queueMc2ReplayRecoveryBatch(candidates);
  return scheduledJson({
    ok: true,
    enabled: true,
    queued: queued.created,
    inspectedCandidates: candidates.length,
    inspectedJobs: queued.jobs,
    expired: due.expired,
    processed: due.results.length,
    results: due.results,
  });
};
