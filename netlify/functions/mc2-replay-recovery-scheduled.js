import { supabaseGet, supabasePatch } from './lib/supabase-rest.mjs';
import {
  mc2ReplayRecoveryConfig,
  mc2ReplayRecoveryEnabled,
  processMc2ReplayRecoveryJob,
  queueMc2ReplayRecoveryBatch,
} from './lib/mc2-replay-recovery.mjs';
import { scheduledJson } from './lib/scheduled-response.mjs';

const DUE_JOB_LIMIT = 10;

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
  const jobs = await supabaseGet(
    `mc2_replay_recovery_jobs?status=in.(pending,retry)&due_at=lte.${encodeURIComponent(now.toISOString())}`
      + `&select=*&order=due_at.asc&limit=${DUE_JOB_LIMIT}`,
  );
  if (!jobs.ok) throw new Error(`mc2_recovery_jobs_${jobs.status}`);
  const results = [];
  for (const job of jobs.data || []) {
    results.push({ id: job.id, ...(await processMc2ReplayRecoveryJob(job, now)) });
  }
  return results;
}

export default async () => {
  if (!mc2ReplayRecoveryEnabled()) {
    return scheduledJson({ ok: true, enabled: false, queued: 0, processed: 0 });
  }

  const now = new Date();
  mc2ReplayRecoveryConfig();

  // Priorité absolue aux communications déjà dues. Même si la reconstruction
  // de la file devait rencontrer un problème, un email prêt ne reste plus
  // bloqué derrière le balayage historique.
  const results = await processDueJobs(now);

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
    processed: results.length,
    results,
  });
};
