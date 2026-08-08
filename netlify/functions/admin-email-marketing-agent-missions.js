import { randomUUID } from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import {
  acquireDirectMissionLock,
  getDirectMission,
  getDirectMissionHistory,
  releaseDirectMissionLock,
  saveDirectMission,
} from './lib/email-division-redis.mjs';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const MAX_ACTIVE_MISSIONS = 3;

const AGENTS = Object.freeze({
  nova: { name: 'Nova', role: 'Directrice de division', specialty: 'Coordination, arbitrage et décisions.' },
  eli: { name: 'Eli', role: 'Chef de produit', specialty: 'Offres, parcours produits et cohérence commerciale.' },
  milo: { name: 'Milo', role: 'Archiviste & Knowledge Manager', specialty: 'Mémoire, sources et apprentissages durables.' },
  alma: { name: 'Alma', role: 'Stratège éditoriale', specialty: 'Angles, calendrier et valeur éditoriale.' },
  leo: { name: 'Léo', role: 'Copywriter email', specialty: 'Rédaction claire, humaine et orientée action.' },
  iris: { name: 'Iris', role: 'Chercheuse Voix du Client', specialty: 'Recherche, signaux d’audience et veille de référence.' },
  nino: { name: 'Nino', role: 'Opérations broadcast', specialty: 'Préflight, tracking et préparation technique.' },
  sacha: { name: 'Sacha', role: 'Analyste performance', specialty: 'Analyse des performances et détection de signaux.' },
  ada: { name: 'Ada', role: 'Responsable expérimentation', specialty: 'Hypothèses, tests et apprentissage mesurable.' },
  enzo: { name: 'Enzo', role: 'Rentabilité & attribution', specialty: 'Revenus, attribution et rentabilité.' },
  tao: { name: 'Tao', role: 'Auditeur automations', specialty: 'Diagnostic des automations sans les modifier.' },
  maya: { name: 'Maya', role: 'Délivrabilité & santé', specialty: 'Santé du compte, pression et délivrabilité.' },
  ines: { name: 'Inès', role: 'Segmentation & hygiène', specialty: 'Segmentation, activité et hygiène de base.' },
  sol: { name: 'Sol', role: 'Spécialiste réactivation', specialty: 'Reconquête et réactivation des contacts.' },
  june: { name: 'June', role: 'Qualité & conformité', specialty: 'Contrôle qualité, consentement et garde-fous.' },
});

const DELIVERABLES = Object.freeze({
  recommendations: 'Recommandations argumentées',
  analysis: 'Analyse et diagnostic',
  plan: 'Plan d’action',
  ideas: 'Idées à comparer',
  draft: 'Brouillon interne',
});

const missionResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    executiveSummary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
        required: ['title', 'detail', 'evidence', 'recommendation'],
      },
    },
    deliverables: { type: 'array', items: { type: 'string' } },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          whyRelevant: { type: 'string' },
        },
        required: ['title', 'url', 'whyRelevant'],
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'string' } },
    requiresExternalAction: { type: 'boolean' },
    externalActionProposal: { type: 'string' },
  },
  required: [
    'title', 'executiveSummary', 'findings', 'deliverables', 'sources', 'limitations',
    'nextActions', 'requiresExternalAction', 'externalActionProposal',
  ],
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function safeText(value, maxLength = 500, preserveLines = false) {
  const raw = String(value || '').replace(/\0/g, '');
  const normalized = preserveLines
    ? raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{4,}/g, '\n\n\n').trim()
    : raw.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

function usableSecret(value) {
  const secret = String(value || '').trim();
  return secret && !/^no value\b/i.test(secret) ? secret : '';
}

function openAIKey() {
  return usableSecret(process.env.OPENAI_EMAIL_MARKETING_DIVISION)
    || usableSecret(process.env.OPENAI_API_KEY);
}

function agentModel() {
  return String(process.env.EMAIL_DIVISION_AGENT_MODEL || process.env.EMAIL_DIVISION_AI_MODEL || DEFAULT_MODEL).trim();
}

function isTrustedLocalDevelopment(req) {
  if (!process.env.NETLIFY_DEV) return false;
  try {
    const hostname = new URL(req.url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function providerError(status) {
  if (status === 401 || status === 403) return 'openai_authentication_failed';
  if (status === 429) return 'openai_rate_limited';
  if (status >= 500) return 'openai_service_unavailable';
  return `openai_request_failed_${status}`;
}

function extractOutputText(response) {
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) return content.text;
      if (content?.type === 'refusal') throw new Error('openai_refusal');
    }
  }
  throw new Error(response?.incomplete_details?.reason || 'openai_output_missing');
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().slice(0, 1_000) : '';
  } catch {
    return '';
  }
}

function normalizeResult(value) {
  return {
    title: safeText(value?.title, 180),
    executiveSummary: safeText(value?.executiveSummary, 3_000, true),
    findings: (Array.isArray(value?.findings) ? value.findings : []).slice(0, 8).map((finding) => ({
      title: safeText(finding?.title, 180),
      detail: safeText(finding?.detail, 2_500, true),
      evidence: (Array.isArray(finding?.evidence) ? finding.evidence : []).slice(0, 8).map((item) => safeText(item, 700, true)),
      recommendation: safeText(finding?.recommendation, 1_500, true),
    })),
    deliverables: (Array.isArray(value?.deliverables) ? value.deliverables : []).slice(0, 12).map((item) => safeText(item, 1_000, true)),
    sources: (Array.isArray(value?.sources) ? value.sources : []).slice(0, 12).map((source) => ({
      title: safeText(source?.title, 200),
      url: safeUrl(source?.url),
      whyRelevant: safeText(source?.whyRelevant, 800, true),
    })).filter((source) => source.url),
    limitations: (Array.isArray(value?.limitations) ? value.limitations : []).slice(0, 8).map((item) => safeText(item, 800, true)),
    nextActions: (Array.isArray(value?.nextActions) ? value.nextActions : []).slice(0, 8).map((item) => safeText(item, 800, true)),
    requiresExternalAction: Boolean(value?.requiresExternalAction),
    externalActionProposal: safeText(value?.externalActionProposal, 1_200, true),
  };
}

function agentInstructions(mission) {
  const agent = AGENTS[mission.agentId];
  return `Tu es ${agent.name}, ${agent.role}, membre de l’Email Marketing Division de Sonny Court.

Ta spécialité : ${agent.specialty}

Tu exécutes une mission ponctuelle confiée directement par Sonny. Tu produis un dossier interne en français, concret, vérifiable et facile à valider. Distingue toujours les faits observés, les inférences et les recommandations. N’invente aucun chiffre, produit, témoignage, promesse ou résultat.

Garde-fous absolus : tu n’envoies aucun email, tu ne t’inscris à aucune newsletter, tu ne remplis aucun formulaire, tu ne modifies ni MailerLite ni un autre service, tu ne sélectionnes aucun destinataire et tu ne déclenches aucune action externe. Si une action externe serait utile, décris-la seulement dans externalActionProposal et marque requiresExternalAction à true. Elle attendra une validation humaine et une étape séparée.

${mission.webSearchAllowed ? 'La recherche web en lecture seule est autorisée. Utilise-la si elle améliore la fiabilité et fournis les URLs exactes des sources consultées.' : 'La recherche web n’est pas autorisée pour cette mission. Signale les informations manquantes au lieu de les supposer.'}

Le livrable attendu est : ${DELIVERABLES[mission.deliverable]}.`;
}

async function generateMissionResult(mission) {
  const apiKey = openAIKey();
  if (!apiKey) throw new Error('ai_provider_not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  const feedback = mission.review?.decision === 'revision' && mission.review.note
    ? `\n\nCORRECTION DEMANDÉE PAR SONNY\n${mission.review.note}` : '';
  const previous = mission.versions?.length
    ? `\n\nVERSION PRÉCÉDENTE À AMÉLIORER\n${JSON.stringify(mission.versions.at(-1)?.result || {})}` : '';
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: agentModel(),
        store: false,
        reasoning: { effort: 'medium' },
        tools: mission.webSearchAllowed ? [{ type: 'web_search' }] : [],
        text: {
          verbosity: 'medium',
          format: { type: 'json_schema', name: 'email_division_direct_mission', strict: true, schema: missionResultSchema },
        },
        max_output_tokens: 7_000,
        input: [
          { role: 'system', content: agentInstructions(mission) },
          { role: 'user', content: `MISSION DE SONNY\n${mission.objective}${feedback}${previous}` },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(providerError(response.status));
    return {
      result: normalizeResult(JSON.parse(extractOutputText(payload))),
      provider: 'openai',
      model: payload.model || agentModel(),
      responseId: payload.id || null,
      usage: payload.usage || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeDirectMission(id) {
  const token = randomUUID();
  if (!(await acquireDirectMissionLock(id, token))) throw new Error('direct_mission_already_running');
  let mission = null;
  try {
    mission = await getDirectMission(id);
    if (!mission) throw new Error('direct_mission_not_found');
    mission = {
      ...mission,
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempt: Math.max(1, Number(mission.attempt || 0) + 1),
      error: null,
    };
    await saveDirectMission(mission);
    const generated = await generateMissionResult(mission);
    mission = {
      ...mission,
      ...generated,
      status: 'review',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      review: null,
    };
    await saveDirectMission(mission);
    return mission;
  } catch (error) {
    if (mission) {
      mission = {
        ...mission,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: safeText(error?.message, 300),
      };
      await saveDirectMission(mission).catch(() => {});
    }
    throw error;
  } finally {
    await releaseDirectMissionLock(id, token).catch(() => {});
  }
}

async function dispatchWorker(req, missionId) {
  const workerUrl = new URL('/.netlify/functions/admin-email-marketing-agent-mission-worker-background', req.url);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const cookie = req.headers.get('cookie');
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(workerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operation: 'execute_direct_mission', missionId }),
  });
  if (!response.ok) throw new Error(`direct_mission_worker_${response.status}`);
}

function publicMission(mission) {
  if (!mission) return null;
  return { ...mission, safety: { ...mission.safety, mailerliteWrite: false, mailerliteSend: false } };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!getSessionFromRequest(req) && !isTrustedLocalDevelopment(req)) return json(401, { error: 'authentication_required' });
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const id = safeText(url.searchParams.get('id'), 80);
      if (id) {
        const mission = await getDirectMission(id);
        return mission ? json(200, { mission: publicMission(mission), mailerliteWritePerformed: false }) : json(404, { error: 'mission_not_found' });
      }
      const missions = await getDirectMissionHistory(Number(url.searchParams.get('limit')) || 40);
      return json(200, { missions: missions.map(publicMission), durable: true, mailerliteWritePerformed: false });
    }
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', allowed: ['GET', 'POST'] });
    const body = await req.json().catch(() => ({}));

    if (body.operation === 'start') {
      const agentId = safeText(body.agentId, 40).toLowerCase();
      const objective = safeText(body.objective, 1_500, true);
      const deliverable = Object.hasOwn(DELIVERABLES, body.deliverable) ? body.deliverable : 'recommendations';
      if (!AGENTS[agentId]) return json(400, { error: 'unknown_agent' });
      if (objective.length < 12) return json(400, { error: 'mission_too_short' });
      const history = await getDirectMissionHistory(20);
      const activeCount = history.filter((mission) => ['queued', 'running'].includes(mission.status)).length;
      if (activeCount >= MAX_ACTIVE_MISSIONS) return json(429, { error: 'too_many_active_missions', limit: MAX_ACTIVE_MISSIONS });
      const now = new Date().toISOString();
      const mission = {
        id: randomUUID(),
        type: 'direct',
        agentId,
        agent: AGENTS[agentId],
        objective,
        deliverable,
        deliverableLabel: DELIVERABLES[deliverable],
        webSearchAllowed: Boolean(body.webSearchAllowed),
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        finishedAt: null,
        attempt: 0,
        result: null,
        review: null,
        versions: [],
        safety: {
          internalAnalysisOnly: true,
          humanApprovalRequired: true,
          externalActions: false,
          mailerliteWrite: false,
          mailerliteSend: false,
        },
      };
      await saveDirectMission(mission);
      try {
        await dispatchWorker(req, mission.id);
      } catch (error) {
        await saveDirectMission({ ...mission, status: 'failed', updatedAt: new Date().toISOString(), error: safeText(error?.message, 300) });
        throw error;
      }
      return json(202, { mission: publicMission(mission), accepted: true, mailerliteWritePerformed: false });
    }

    if (body.operation === 'decide') {
      const id = safeText(body.id, 80);
      const decision = ['approved', 'revision', 'abandoned'].includes(body.decision) ? body.decision : '';
      const note = safeText(body.note, 1_500, true);
      const mission = await getDirectMission(id);
      if (!mission) return json(404, { error: 'mission_not_found' });
      if (!decision) return json(400, { error: 'invalid_decision' });
      if (decision === 'revision' && note.length < 3) return json(400, { error: 'revision_note_required' });
      const now = new Date().toISOString();
      if (decision === 'revision') {
        const revised = {
          ...mission,
          status: 'queued',
          updatedAt: now,
          finishedAt: null,
          review: { decision, note, at: now, by: 'Sonny' },
          versions: [...(Array.isArray(mission.versions) ? mission.versions : []), { at: now, result: mission.result }].slice(-5),
          result: null,
        };
        await saveDirectMission(revised);
        await dispatchWorker(req, id);
        return json(202, { mission: publicMission(revised), accepted: true, mailerliteWritePerformed: false });
      }
      const reviewed = {
        ...mission,
        status: decision === 'approved' ? 'done' : 'archived',
        updatedAt: now,
        review: { decision, note, at: now, by: 'Sonny' },
      };
      await saveDirectMission(reviewed);
      return json(200, { mission: publicMission(reviewed), mailerliteWritePerformed: false });
    }

    return json(400, { error: 'unsupported_operation' });
  } catch (error) {
    const message = safeText(error?.message, 300);
    console.error('[admin-email-marketing-agent-missions] failed', message);
    if (message === 'email_division_storage_not_configured') return json(503, { error: message });
    if (message === 'ai_provider_not_configured') return json(503, { error: message });
    return json(502, { error: 'direct_mission_failed', detail: message, mailerliteWritePerformed: false });
  }
};
