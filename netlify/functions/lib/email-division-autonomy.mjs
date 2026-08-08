import { randomUUID } from 'node:crypto';
import { EMAIL_INTELLIGENCE_VERSION, executeBroadcastRun } from '../admin-email-marketing-agent-runs.js';
import { loadOverview } from '../admin-email-marketing-overview.js';
import {
  acquireAutonomyLock,
  getAutonomyPulseHistory,
  getAutonomyState,
  getBroadcastWorkspace,
  getLatestAutonomyPulse,
  getLatestRun,
  releaseAutonomyLock,
  saveAutonomyPulse,
  saveAutonomyState,
} from './email-division-redis.mjs';

const DAILY_SCHEDULE_UTC = '0 6 * * *';
const MAX_PULSE_HISTORY = 31;
const MIN_AI_INTERVAL_MS = 72 * 60 * 60 * 1000;
const PRICING_AS_OF = '2026-08-06';

export const DEFAULT_AUTONOMY_STATE = Object.freeze({
  enabled: true,
  mode: 'green_only',
  scheduleUtc: DAILY_SCHEDULE_UTC,
  scheduleLabel: 'Chaque jour · 06:00 UTC (07:00/08:00 à Zurich)',
  maxDailyAiRuns: 1,
  monthlyBudgetUsd: 40,
  requireHybrid: true,
  humanApprovalRequired: true,
  mailerliteWrite: false,
  mailerliteSend: false,
  updatedAt: null,
});

function usableSecret(value) {
  const secret = String(value || '').trim();
  return secret && !/^no value\b/i.test(secret) ? secret : '';
}

function hasOpenAI() {
  return Boolean(usableSecret(process.env.OPENAI_EMAIL_MARKETING_DIVISION) || usableSecret(process.env.OPENAI_API_KEY));
}

function hasAnthropic() {
  return Boolean(usableSecret(process.env.ANTHROPIC_API_KEY) || usableSecret(process.env.ANTHROPIC_API_KEY_EMAIL_PACK));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 10000) / 10000;
}

function safeDate(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function daysUntil(target, now) {
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function fourthFridayOfNovember(year) {
  const first = new Date(Date.UTC(year, 10, 1, 12));
  const firstFriday = 1 + ((5 - first.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, 10, firstFriday + 21, 12));
}

function annualEventCandidates(now) {
  const year = now.getUTCFullYear();
  const entries = [];
  for (const candidateYear of [year, year + 1]) {
    entries.push(
      {
        id: `rentree-${candidateYear}`,
        name: 'Rentrée francophone',
        targetAt: new Date(Date.UTC(candidateYear, 8, 1, 12)),
        planningLeadDays: 35,
        note: 'Opportunité éditoriale à évaluer, sans promotion ni réduction supposée.',
      },
      {
        id: `black-friday-${candidateYear}`,
        name: 'Black Friday',
        targetAt: fourthFridayOfNovember(candidateYear),
        planningLeadDays: 45,
        note: 'Fenêtre commerciale à préparer uniquement si une offre et ses règles sont validées.',
      },
      {
        id: `nouvelle-annee-${candidateYear + 1}`,
        name: 'Nouvelle année',
        targetAt: new Date(Date.UTC(candidateYear + 1, 0, 1, 12)),
        planningLeadDays: 31,
        note: 'Angle de transition et de projection à évaluer, sans offre implicite.',
      },
    );
  }
  return entries
    .filter((event) => event.targetAt.getTime() >= now.getTime() - 86_400_000)
    .sort((a, b) => a.targetAt - b.targetAt);
}

function nextCommercialEvent(now) {
  const event = annualEventCandidates(now)[0];
  if (!event) return null;
  const remainingDays = daysUntil(event.targetAt, now);
  return {
    ...event,
    targetAt: event.targetAt.toISOString(),
    daysUntil: remainingDays,
    planningWindowOpen: remainingDays <= event.planningLeadDays,
  };
}

function signal({ id, agentId, agent, priority, title, finding, recommendation, evidence = [], status = 'observed' }) {
  return {
    id,
    agentId,
    agent,
    priority,
    title,
    finding,
    recommendation,
    evidence: evidence.filter(Boolean).slice(0, 6),
    status,
    allowedAction: 'internal_analysis_only',
    requiresHumanReview: true,
  };
}

function buildSignals(overview, now) {
  const metrics = overview?.metrics || {};
  const signals = [];
  const campaigns30 = safeNumber(metrics.campaignsLast30Days);
  const lastBroadcastDays = metrics.lastBroadcastDays == null ? null : safeNumber(metrics.lastBroadcastDays);
  const cadenceNeedsAttention = campaigns30 < 4 || lastBroadcastDays == null || lastBroadcastDays > 8;
  signals.push(signal({
    id: 'cadence-broadcast',
    agentId: 'alma',
    agent: 'Alma',
    priority: cadenceNeedsAttention ? 'high' : 'low',
    title: 'Cadence éditoriale',
    finding: cadenceNeedsAttention
      ? 'La cadence observée mérite un nouveau dossier de broadcast de valeur.'
      : 'La cadence récente se situe dans la zone de travail hebdomadaire.',
    recommendation: cadenceNeedsAttention
      ? 'Préparer un angle utile et un brouillon pour validation humaine.'
      : 'Maintenir la cadence sans ajouter un envoi artificiel.',
    evidence: [
      `${campaigns30} broadcast(s) sur 30 jours`,
      lastBroadcastDays == null ? 'Dernier grand broadcast non déterminé' : `Dernier grand broadcast il y a ${lastBroadcastDays} jour(s)`,
    ],
    status: cadenceNeedsAttention ? 'review' : 'clear',
  }));

  const unsubscribeRate = safeNumber(metrics.unsubscribeRate90Days);
  const inactiveContacts = metrics.inactiveContacts == null ? null : safeNumber(metrics.inactiveContacts);
  const healthNeedsAttention = unsubscribeRate > 0.3 || (inactiveContacts != null && inactiveContacts > 0);
  signals.push(signal({
    id: 'account-health',
    agentId: 'maya',
    agent: 'Maya',
    priority: unsubscribeRate > 0.3 ? 'high' : healthNeedsAttention ? 'medium' : 'low',
    title: 'Santé et activité de la base',
    finding: healthNeedsAttention
      ? 'La base contient des signaux qui justifient une revue de délivrabilité et d’inactivité.'
      : 'Aucun signal agrégé majeur ne demande une action immédiate.',
    recommendation: 'Produire un diagnostic et une proposition de segmentation ; ne déplacer ni archiver aucun contact.',
    evidence: [
      `Désinscriptions pondérées : ${unsubscribeRate.toFixed(2)} %`,
      inactiveContacts == null ? 'Segment inactif non disponible' : `${inactiveContacts} contact(s) dans le segment inactif observé`,
    ],
    status: healthNeedsAttention ? 'review' : 'clear',
  }));

  const inspected = safeNumber(metrics.inspectedRecentCampaigns);
  const tracked = safeNumber(metrics.trackedRecentCampaigns);
  const trackingGap = Math.max(0, inspected - tracked);
  signals.push(signal({
    id: 'revenue-attribution',
    agentId: 'enzo',
    agent: 'Enzo',
    priority: trackingGap > 0 ? 'medium' : 'low',
    title: 'Attribution et rentabilité',
    finding: trackingGap > 0
      ? `${trackingGap} campagne(s) récente(s) inspectée(s) ne montrent pas de tracking détecté.`
      : 'Le tracking détectable couvre les campagnes récentes inspectées.',
    recommendation: 'Documenter les trous de mesure et proposer un plan de tracking avant de conclure sur le revenu email.',
    evidence: [`${tracked}/${inspected} campagne(s) récente(s) avec tracking détecté`],
    status: trackingGap > 0 ? 'review' : 'clear',
  }));

  const event = nextCommercialEvent(now);
  if (event) {
    signals.push(signal({
      id: `calendar-${event.id}`,
      agentId: 'eli',
      agent: 'Eli',
      priority: event.planningWindowOpen ? 'medium' : 'low',
      title: `Calendrier · ${event.name}`,
      finding: `${event.name} arrive dans ${event.daysUntil} jour(s).`,
      recommendation: event.planningWindowOpen
        ? 'Ouvrir un dossier d’opportunité et demander les règles produit avant toute proposition promotionnelle.'
        : 'Conserver l’événement en veille et le réévaluer à l’ouverture de sa fenêtre de préparation.',
      evidence: [event.note, `Date cible : ${event.targetAt.slice(0, 10)}`],
      status: event.planningWindowOpen ? 'review' : 'watch',
    }));
  }

  if (Array.isArray(overview?.unavailable) && overview.unavailable.length) {
    signals.push(signal({
      id: 'data-completeness',
      agentId: 'june',
      agent: 'June',
      priority: 'medium',
      title: 'Complétude du briefing',
      finding: `${overview.unavailable.length} source(s) de lecture sont momentanément indisponibles.`,
      recommendation: 'Ne pas tirer de conclusion définitive sur les données manquantes et relancer le scan au prochain pulse.',
      evidence: overview.unavailable.map((source) => `Source indisponible : ${String(source).slice(0, 80)}`),
      status: 'review',
    }));
  }

  return signals;
}

function mergeState(stored = {}) {
  return {
    ...DEFAULT_AUTONOMY_STATE,
    ...(stored && typeof stored === 'object' ? stored : {}),
    mode: 'green_only',
    requireHybrid: true,
    humanApprovalRequired: true,
    mailerliteWrite: false,
    mailerliteSend: false,
    maxDailyAiRuns: 1,
    monthlyBudgetUsd: Math.max(0, safeNumber(stored?.monthlyBudgetUsd, DEFAULT_AUTONOMY_STATE.monthlyBudgetUsd)),
  };
}

function runWasReviewed(latestRun, workspace) {
  if (!latestRun || latestRun.status !== 'completed') return true;
  const approvalAt = safeDate(workspace?.state?.contentApproval?.at);
  const finishedAt = safeDate(latestRun.finishedAt || latestRun.startedAt);
  return Boolean(approvalAt && finishedAt && approvalAt.getTime() >= finishedAt.getTime());
}

function pulseCost(pulse) {
  return safeNumber(pulse?.budget?.estimatedCostUsd);
}

function budgetSnapshot(history, now, limit) {
  const today = dateKey(now);
  const month = monthKey(now);
  const spentTodayUsd = history
    .filter((pulse) => String(pulse?.dateKey || '') === today)
    .reduce((sum, pulse) => sum + pulseCost(pulse), 0);
  const spentMonthUsd = history
    .filter((pulse) => String(pulse?.dateKey || '').startsWith(month))
    .reduce((sum, pulse) => sum + pulseCost(pulse), 0);
  return {
    spentTodayUsd: roundMoney(spentTodayUsd),
    spentMonthUsd: roundMoney(spentMonthUsd),
    monthlyLimitUsd: roundMoney(limit),
    remainingMonthUsd: roundMoney(Math.max(0, limit - spentMonthUsd)),
  };
}

function isAiPlanningDay(now) {
  const day = now.getUTCDay();
  return day === 1 || day === 4;
}

function lastGeneratedPulse(history) {
  return history.find((pulse) => pulse?.decision?.aiRun?.status === 'generated' && pulse?.finishedAt) || null;
}

function decideAiRun({ state, history, latestRun, workspace, now, force }) {
  const budget = budgetSnapshot(history, now, state.monthlyBudgetUsd);
  if (!state.enabled) return { status: 'paused', reason: 'autonomy_paused', budget };
  if (!runWasReviewed(latestRun, workspace)) return { status: 'awaiting_human_review', reason: 'previous_dossier_requires_review', budget };
  if (!hasOpenAI() || !hasAnthropic()) return { status: 'providers_missing', reason: 'hybrid_ai_not_configured', budget };
  if (budget.spentMonthUsd >= state.monthlyBudgetUsd) return { status: 'budget_exhausted', reason: 'monthly_budget_reached', budget };
  if (!force && !isAiPlanningDay(now)) return { status: 'not_scheduled', reason: 'analysis_only_day', budget };
  const todayRuns = history.filter((pulse) => pulse?.dateKey === dateKey(now) && pulse?.decision?.aiRun?.status === 'generated').length;
  if (todayRuns >= state.maxDailyAiRuns) return { status: 'daily_limit', reason: 'daily_ai_limit_reached', budget };
  const previous = lastGeneratedPulse(history);
  const previousAt = safeDate(previous?.finishedAt);
  if (!force && previousAt && now.getTime() - previousAt.getTime() < MIN_AI_INTERVAL_MS) {
    return { status: 'cooldown', reason: 'minimum_interval_not_reached', budget };
  }
  return { status: 'eligible', reason: force ? 'human_requested_pulse' : 'scheduled_planning_day', budget };
}

function openAICost(usage = {}) {
  const input = safeNumber(usage.input_tokens);
  const cached = Math.min(input, safeNumber(usage.input_tokens_details?.cached_tokens));
  const output = safeNumber(usage.output_tokens);
  return ((input - cached) * 5 + cached * 0.5 + output * 30) / 1_000_000;
}

function anthropicCost(usage = {}) {
  const input = safeNumber(usage.input_tokens);
  const output = safeNumber(usage.output_tokens);
  const cacheRead = safeNumber(usage.cache_read_input_tokens);
  const cacheWrite = safeNumber(usage.cache_creation_input_tokens);
  return (input * 10 + output * 50 + cacheRead * 1 + cacheWrite * 12.5) / 1_000_000;
}

export function estimateRunCost(run) {
  const usage = run?.usage || {};
  let estimate = 0;
  if (usage.director || usage.writer || usage.review) {
    estimate += openAICost(usage.director);
    estimate += anthropicCost(usage.writer);
    estimate += openAICost(usage.review);
  } else if (run?.provider === 'openai') {
    estimate += openAICost(usage);
  } else if (run?.provider === 'anthropic') {
    estimate += anthropicCost(usage);
  }
  return {
    estimatedCostUsd: roundMoney(estimate),
    pricingAsOf: PRICING_AS_OF,
    estimateOnly: true,
  };
}

export function nextScheduledAt(now = new Date()) {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(6);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export async function updateAutonomyEnabled(enabled) {
  const current = mergeState(await getAutonomyState());
  const updated = { ...current, enabled: Boolean(enabled), updatedAt: new Date().toISOString() };
  await saveAutonomyState(updated);
  return updated;
}

export async function getAutonomySnapshot() {
  const now = new Date();
  const [stored, latestPulse, history] = await Promise.all([
    getAutonomyState(),
    getLatestAutonomyPulse(),
    getAutonomyPulseHistory(MAX_PULSE_HISTORY),
  ]);
  const state = mergeState(stored);
  return {
    state,
    latestPulse,
    history: history.slice(0, 14),
    budget: budgetSnapshot(history, now, state.monthlyBudgetUsd),
    nextRunAt: nextScheduledAt(now),
    guardrails: {
      mode: 'green_only',
      allowed: ['mailerlite_read', 'aggregate_analysis', 'internal_draft', 'internal_memory'],
      forbidden: ['mailerlite_write', 'mailerlite_send', 'contact_archive', 'automation_change'],
      humanApprovalRequired: true,
    },
  };
}

export async function executeAutonomyPulse({ trigger = 'manual', force = false } = {}) {
  const lockToken = randomUUID();
  if (!(await acquireAutonomyLock(lockToken))) throw new Error('autonomy_pulse_already_in_progress');
  const now = new Date();
  const id = randomUUID();
  let pulse = {
    id,
    dateKey: dateKey(now),
    trigger: trigger === 'scheduled' ? 'scheduled' : 'manual',
    status: 'scanning',
    startedAt: now.toISOString(),
    finishedAt: null,
    signals: [],
    decision: { aiRun: { status: 'pending', reason: 'scan_in_progress' } },
    budget: { estimatedCostUsd: 0, pricingAsOf: PRICING_AS_OF, estimateOnly: true },
    safety: {
      mode: 'green_only',
      mailerliteRead: true,
      mailerliteWrite: false,
      mailerliteSend: false,
      contactArchive: false,
      automationChange: false,
      humanApprovalRequired: true,
    },
  };
  try {
    const [stored, history, latestPulse, latestRun, workspace] = await Promise.all([
      getAutonomyState(),
      getAutonomyPulseHistory(MAX_PULSE_HISTORY),
      getLatestAutonomyPulse(),
      getLatestRun(),
      getBroadcastWorkspace(),
    ]);
    const state = mergeState(stored);
    if (!force && trigger === 'scheduled' && latestPulse?.dateKey === pulse.dateKey && latestPulse?.trigger === 'scheduled') {
      return latestPulse;
    }

    const overview = await loadOverview(usableSecret(process.env.MAILERLITE_API_KEY));
    pulse = {
      ...pulse,
      status: 'planning',
      sourceSnapshot: { generatedAt: overview.generatedAt, metrics: overview.metrics, unavailable: overview.unavailable || [] },
      signals: buildSignals(overview, now),
    };
    await saveAutonomyPulse(pulse);

    const currentLatestRun = latestRun?.analysisVersion === EMAIL_INTELLIGENCE_VERSION ? latestRun : null;
    const aiDecision = decideAiRun({ state, history, latestRun: currentLatestRun, workspace, now, force });
    pulse = { ...pulse, decision: { aiRun: aiDecision } };
    if (aiDecision.status === 'eligible') {
      try {
        pulse = { ...pulse, status: 'producing' };
        await saveAutonomyPulse(pulse);
        const run = await executeBroadcastRun();
        pulse = {
          ...pulse,
          decision: {
            aiRun: {
              status: 'generated',
              reason: 'dossier_created_for_human_review',
              runId: run.id,
              qualityScore: safeNumber(run?.artifact?.qa?.score),
            },
          },
          budget: estimateRunCost(run),
        };
      } catch (error) {
        console.error('[email-division-autonomy] AI production failed', String(error?.message || error).slice(0, 160));
        pulse = {
          ...pulse,
          decision: { aiRun: { status: 'failed', reason: 'ai_production_failed_safely' } },
        };
      }
    }

    pulse = {
      ...pulse,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      summary: {
        signalsFound: pulse.signals.length,
        reviewItems: pulse.signals.filter((item) => item.status === 'review').length,
        aiDossierCreated: pulse.decision.aiRun.status === 'generated',
      },
    };
    await saveAutonomyPulse(pulse);
    await saveAutonomyState({ ...state, lastPulseAt: pulse.finishedAt, updatedAt: pulse.finishedAt });
    return pulse;
  } catch (error) {
    pulse = {
      ...pulse,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: 'autonomy_pulse_failed_safely',
    };
    await saveAutonomyPulse(pulse).catch(() => {});
    throw error;
  } finally {
    await releaseAutonomyLock(lockToken).catch(() => {});
  }
}
