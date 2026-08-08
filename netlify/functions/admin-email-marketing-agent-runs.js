import { randomUUID } from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { loadOverview } from './admin-email-marketing-overview.js';
import {
  acquireRunLock,
  getBroadcastWorkspace,
  getLatestRun,
  getRun,
  releaseRunLock,
  saveBroadcastWorkspace,
  saveRun,
} from './lib/email-division-redis.mjs';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_CLAUDE_MODEL = 'claude-fable-5';
const RUN_COOLDOWN_MS = 3 * 60 * 1000;
export const EMAIL_INTELLIGENCE_VERSION = 'broadcast-intelligence-v2';

function usableSecret(value) {
  const secret = String(value || '').trim();
  if (!secret || /^no value\b/i.test(secret)) return '';
  return secret;
}

function openAIDirectorKey() {
  return usableSecret(process.env.OPENAI_EMAIL_MARKETING_DIVISION)
    || usableSecret(process.env.OPENAI_API_KEY);
}

function anthropicWriterKey() {
  return usableSecret(process.env.ANTHROPIC_API_KEY)
    || usableSecret(process.env.ANTHROPIC_API_KEY_EMAIL_PACK);
}

function directorModel() {
  return String(process.env.EMAIL_DIVISION_AI_MODEL || DEFAULT_MODEL).trim();
}

function writerModel() {
  return String(process.env.EMAIL_DIVISION_CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL).trim();
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

function providerError(provider, status) {
  if (status === 401 || status === 403) return `${provider}_authentication_failed`;
  if (status === 429) return `${provider}_rate_limited`;
  if (status >= 500) return `${provider}_service_unavailable`;
  return `${provider}_request_failed_${status}`;
}

function safeText(value, maxLength = 500, preserveLines = false) {
  const raw = String(value || '').replace(/\0/g, '');
  const normalized = preserveLines
    ? raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{4,}/g, '\n\n\n').trim()
    : raw.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

function safeDate(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizeDraft(input = {}) {
  const audienceType = ['group', 'segment'].includes(input.audienceType) ? input.audienceType : '';
  return {
    campaignName: safeText(input.campaignName, 255),
    subject: safeText(input.subject, 255),
    subjectVariant: safeText(input.subjectVariant, 255),
    preheader: safeText(input.preheader, 255),
    fromName: safeText(input.fromName, 255),
    fromAddress: safeText(input.fromAddress, 255).toLowerCase(),
    audienceType,
    audienceId: audienceType ? safeText(input.audienceId, 80) : '',
    audienceName: audienceType ? safeText(input.audienceName, 180) : '',
    audienceCount: Math.max(0, Math.round(Number(input.audienceCount) || 0)),
    body: safeText(input.body, 20_000, true),
    ctaLabel: safeText(input.ctaLabel, 120),
    ctaUrl: safeText(input.ctaUrl, 500),
    hypothesis: safeText(input.hypothesis, 2_000, true),
  };
}

function sanitizeWorkspace(input = {}) {
  const state = input.state || {};
  const versions = Array.isArray(state.versions) ? state.versions.slice(0, 20).map((version) => ({
    at: safeDate(version?.at) || new Date().toISOString(),
    author: safeText(version?.author, 80) || 'Sonny',
    draft: sanitizeDraft(version?.draft),
  })) : [];
  const approval = state.contentApproval && typeof state.contentApproval === 'object'
    ? { snapshot: safeText(state.contentApproval.snapshot, 40_000, true), at: safeDate(state.contentApproval.at) }
    : null;
  const decision = input.missionDecision && typeof input.missionDecision === 'object'
    ? {
        type: ['approved', 'revision'].includes(input.missionDecision.type) ? input.missionDecision.type : '',
        note: safeText(input.missionDecision.note, 1_000, true),
        at: safeDate(input.missionDecision.at) || new Date().toISOString(),
      }
    : null;
  const proof = state.testProof && typeof state.testProof === 'object'
    ? {
        sentAt: safeDate(state.testProof.sentAt),
        snapshotHash: /^[a-f0-9]{64}$/i.test(String(state.testProof.snapshotHash || ''))
          ? String(state.testProof.snapshotHash).toLowerCase() : '',
        sentSnapshot: safeText(state.testProof.sentSnapshot, 40_000, true),
        recipients: (Array.isArray(state.testProof.recipients) ? state.testProof.recipients : [])
          .slice(0, 5).map((email) => safeText(email, 255).toLowerCase()).filter(Boolean),
        campaign: state.testProof.campaign && typeof state.testProof.campaign === 'object'
          ? {
              id: safeText(state.testProof.campaign.id, 80),
              name: safeText(state.testProof.campaign.name, 255),
              status: safeText(state.testProof.campaign.status, 40),
              subject: safeText(state.testProof.campaign.subject, 255),
            }
          : null,
      }
    : null;
  return {
    missionId: 'broadcast-value',
    intelligenceVersion: EMAIL_INTELLIGENCE_VERSION,
    updatedAt: new Date().toISOString(),
    missionDecision: decision?.type ? decision : null,
    state: {
      draft: state.draft ? sanitizeDraft(state.draft) : null,
      versions,
      contentApproval: approval?.snapshot && approval.at ? approval : null,
      mailerlite: state.mailerlite || null,
      sent: state.sent || null,
      testProof: proof?.sentAt && proof.snapshotHash ? proof : null,
    },
  };
}

const runSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executiveSummary: { type: 'string' },
    recommendedAngle: { type: 'string' },
    valuePromise: { type: 'string' },
    targetAudienceReasoning: { type: 'string' },
    subjectA: { type: 'string' },
    subjectB: { type: 'string' },
    preheader: { type: 'string' },
    emailBody: { type: 'string' },
    ctaLabel: { type: 'string' },
    ctaUrlRecommendation: { type: 'string' },
    hypothesis: { type: 'string' },
    agentContributions: {
      type: 'array',
      minItems: 9,
      maxItems: 9,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: { type: 'string', enum: ['iris', 'sacha', 'eli', 'alma', 'ada', 'leo', 'nino', 'june', 'nova'] },
          agent: { type: 'string' },
          role: { type: 'string' },
          finding: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          status: { type: 'string', enum: ['done', 'review', 'blocked'] },
        },
        required: ['agentId', 'agent', 'role', 'finding', 'evidence', 'recommendation', 'status'],
      },
    },
    qa: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        verdict: { type: 'string', enum: ['ready_for_human_review', 'revision_needed', 'blocked'] },
        strengths: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        requiredFixes: { type: 'array', items: { type: 'string' } },
      },
      required: ['score', 'verdict', 'strengths', 'risks', 'requiredFixes'],
    },
  },
  required: [
    'executiveSummary', 'recommendedAngle', 'valuePromise', 'targetAudienceReasoning',
    'subjectA', 'subjectB', 'preheader', 'emailBody', 'ctaLabel', 'ctaUrlRecommendation',
    'hypothesis', 'agentContributions', 'qa',
  ],
};

const directorBriefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executiveSummary: { type: 'string' },
    recommendedAngle: { type: 'string' },
    valuePromise: { type: 'string' },
    targetAudienceReasoning: { type: 'string' },
    hypothesis: { type: 'string' },
    ctaGuidance: { type: 'string' },
    copyConstraints: { type: 'array', items: { type: 'string' } },
    evidenceUsed: { type: 'array', items: { type: 'string' } },
    agentContributions: {
      type: 'array',
      minItems: 8,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: { type: 'string', enum: ['iris', 'sacha', 'eli', 'alma', 'ada', 'nino', 'june', 'nova'] },
          agent: { type: 'string' },
          role: { type: 'string' },
          finding: { type: 'string' },
          evidence: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          status: { type: 'string', enum: ['done', 'review', 'blocked'] },
        },
        required: ['agentId', 'agent', 'role', 'finding', 'evidence', 'recommendation', 'status'],
      },
    },
  },
  required: [
    'executiveSummary', 'recommendedAngle', 'valuePromise', 'targetAudienceReasoning',
    'hypothesis', 'ctaGuidance', 'copyConstraints', 'evidenceUsed', 'agentContributions',
  ],
};

const directorReviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    verdict: { type: 'string', enum: ['ready_for_human_review', 'revision_needed', 'blocked'] },
    strengths: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    requiredFixes: { type: 'array', items: { type: 'string' } },
    directorDecision: { type: 'string', enum: ['submit_to_sonny', 'return_to_writer', 'block'] },
    rationale: { type: 'string' },
  },
  required: ['score', 'verdict', 'strengths', 'risks', 'requiredFixes', 'directorDecision', 'rationale'],
};

function compactOverview(overview) {
  return {
    generatedAt: overview.generatedAt,
    metrics: overview.metrics,
    recentCampaigns: (overview.recentCampaigns || []).map((campaign) => ({
      name: campaign.name,
      subject: campaign.subject,
      sent: campaign.sent,
      sentAt: campaign.sentAt,
      openRate: campaign.openRate,
      clickRate: campaign.clickRate,
      unsubscribeRate: campaign.unsubscribeRate,
    })),
  };
}

function systemPrompt() {
  return `Tu es Nova, directrice de l'Email Marketing Division de Sonny Court. Tu coordonnes neuf spécialistes pour préparer un broadcast de valeur en français.

RÈGLES ABSOLUES
- Tu travailles uniquement à partir des données agrégées fournies. N'invente aucune métrique, preuve, offre, produit, témoignage, urgence ou fait sur Sonny Court.
- Tu n'accèdes à aucun contact individuel. Tu peux recommander un profil d'audience au niveau agrégé, mais tu ne sélectionnes aucun identifiant et ne déclenches aucune action MailerLite.
- L'audience finale, l'adresse d'expéditeur, les modifications MailerLite et tout envoi restent sous validation humaine explicite de Sonny.
- Produis un email utile, sobre, concret et humain. Pas de pression artificielle, pas de promesse non vérifiable.
- Le CTA est facultatif. Si aucun lien précis n'est prouvé par le contexte, retourne ctaLabel et ctaUrlRecommendation vides ; n'invente jamais un lien générique.
- Tu peux utiliser {$name} au maximum une fois. N'ajoute pas de HTML.
- Chaque constat doit être relié à une preuve présente dans le contexte. Si l'information manque, marque la contribution concernée « blocked » ou « review ».

ÉQUIPE
- Iris — voix du client et signaux éditoriaux.
- Sacha — performance des campagnes.
- Eli — chef de produit et parcours ; bloque toute recommandation si les règles produit manquent.
- Alma — stratégie éditoriale et cadence.
- Ada — hypothèse d'expérimentation.
- Léo — copywriting de l'email.
- Nino — opérations, CTA et tracking.
- June — qualité, conformité et risques.
- Nova — synthèse et arbitrage final.

LIVRABLE
Un dossier complet prêt à être relu par Sonny, jamais prêt à être envoyé automatiquement. Les neuf contributions doivent être présentes une fois chacune.`;
}

function directorPrompt() {
  return `Rôle : Nova, directrice de l'Email Marketing Division de Sonny Court.

Objectif : transformer les seules données agrégées fournies en un brief éditorial précis pour Léo, le rédacteur Claude. Tu diriges Iris, Sacha, Eli, Alma, Ada, Nino et June, puis arbitres leur travail. Tu ne rédiges pas encore l'email final.

Critères de réussite :
- choisir un seul angle de valeur soutenu par les métriques et objets de campagnes disponibles ;
- demander à Eli de marquer sa contribution « blocked » si aucune règle produit vérifiée n’est fournie ;
- distinguer clairement observation, hypothèse et recommandation ;
- recommander seulement un profil d'audience agrégé, en laissant au cockpit le choix de l'objet MailerLite exact ;
- donner à Léo des contraintes de copywriting actionnables ;
- conserver toute information manquante comme incertitude ;
- rendre un dossier prêt pour la phase de rédaction.

Contraintes absolues : aucune donnée individuelle, aucune invention de produit, offre, témoignage, résultat, urgence ou URL ; aucun identifiant d'audience sélectionné ; aucune action MailerLite ; toute décision externe reste soumise à Sonny. Si aucun CTA vérifié n'existe, les champs CTA restent vides.

Style de direction : net, exigeant, factuel, sans jargon inutile.`;
}

function writerPrompt() {
  return `Rôle : Léo, copywriter principal de l'Email Marketing Division.

Nova, la directrice OpenAI, t'a remis un brief structuré. Rédige un broadcast de valeur en français qui respecte ce brief sans ajouter de faits, d'offres, de produits, de témoignages ou de promesses absents des données.

Le texte doit être humain, sobre, utile et concret. Pas de pression artificielle. Pas de HTML. Tu peux utiliser {$name} au maximum une fois. Le CTA est facultatif : si aucun lien précis n'est prouvé, rends ctaLabel et ctaUrlRecommendation vides.

Reproduis fidèlement dans agentContributions les huit contributions de Nova, puis ajoute exactement une contribution pour Léo. La QA que tu fournis est provisoire : Nova effectuera ensuite le contrôle final. Tu peux décrire le profil d'audience recommandé sans identifiant ; tu ne déclenches aucune action MailerLite.`;
}

function directorReviewPrompt() {
  return `Rôle : Nova, directrice et contrôle final de l'Email Marketing Division.

Évalue le brouillon de Léo contre ton brief et les preuves agrégées. Vérifie la fidélité factuelle, la clarté, la valeur réelle pour le lecteur, la cohérence objet-préheader-corps-CTA, l'absence de promesses inventées et les risques de conformité. Un CTA absent est acceptable ; une URL générique ou non prouvée doit être rejetée.

Ne réécris pas l'email. Retourne un verdict strict et des corrections concrètes. Même si le contenu est bon, il reste seulement soumis à la validation humaine de Sonny ; aucune action MailerLite n'est autorisée.`;
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

function normalizeArtifact(value) {
  const allowedAgents = new Set(['iris', 'sacha', 'eli', 'alma', 'ada', 'leo', 'nino', 'june', 'nova']);
  let ctaUrl = safeText(value?.ctaUrlRecommendation, 500);
  if (ctaUrl) {
    try {
      const parsed = new URL(ctaUrl);
      if (parsed.protocol !== 'https:' || !/(^|\.)sonnycourt\.com$/i.test(parsed.hostname)) ctaUrl = '';
    } catch { ctaUrl = ''; }
  }
  const ctaLabel = ctaUrl ? safeText(value?.ctaLabel, 120) : '';
  const contributions = (Array.isArray(value?.agentContributions) ? value.agentContributions : [])
    .filter((item) => allowedAgents.has(item?.agentId))
    .slice(0, 9)
    .map((item) => ({
      agentId: item.agentId,
      agent: safeText(item.agent, 60),
      role: safeText(item.role, 140),
      finding: safeText(item.finding, 1_500, true),
      evidence: (Array.isArray(item.evidence) ? item.evidence : []).slice(0, 6).map((proof) => safeText(proof, 500)),
      recommendation: safeText(item.recommendation, 1_500, true),
      status: ['done', 'review', 'blocked'].includes(item.status) ? item.status : 'review',
    }));
  if (new Set(contributions.map((item) => item.agentId)).size !== 9) throw new Error('agent_contributions_incomplete');
  return {
    executiveSummary: safeText(value?.executiveSummary, 2_000, true),
    recommendedAngle: safeText(value?.recommendedAngle, 1_000, true),
    valuePromise: safeText(value?.valuePromise, 1_000, true),
    targetAudienceReasoning: safeText(value?.targetAudienceReasoning, 1_500, true),
    subjectA: safeText(value?.subjectA, 255),
    subjectB: safeText(value?.subjectB, 255),
    preheader: safeText(value?.preheader, 255),
    emailBody: safeText(value?.emailBody, 20_000, true),
    ctaLabel,
    ctaUrlRecommendation: ctaUrl,
    hypothesis: safeText(value?.hypothesis, 2_000, true),
    agentContributions: contributions,
    qa: {
      score: Math.max(0, Math.min(100, Math.round(Number(value?.qa?.score) || 0))),
      verdict: ['ready_for_human_review', 'revision_needed', 'blocked'].includes(value?.qa?.verdict)
        ? value.qa.verdict : 'revision_needed',
      strengths: (value?.qa?.strengths || []).slice(0, 8).map((item) => safeText(item, 500)),
      risks: (value?.qa?.risks || []).slice(0, 8).map((item) => safeText(item, 500)),
      requiredFixes: (value?.qa?.requiredFixes || []).slice(0, 8).map((item) => safeText(item, 500)),
    },
  };
}

function normalizeQa(value) {
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(value?.score) || 0))),
    verdict: ['ready_for_human_review', 'revision_needed', 'blocked'].includes(value?.verdict)
      ? value.verdict : 'revision_needed',
    strengths: (Array.isArray(value?.strengths) ? value.strengths : []).slice(0, 8).map((item) => safeText(item, 500)),
    risks: (Array.isArray(value?.risks) ? value.risks : []).slice(0, 8).map((item) => safeText(item, 500)),
    requiredFixes: (Array.isArray(value?.requiredFixes) ? value.requiredFixes : []).slice(0, 8).map((item) => safeText(item, 500)),
  };
}

function normalizeDirectorBrief(value) {
  const allowedAgents = new Set(['iris', 'sacha', 'eli', 'alma', 'ada', 'nino', 'june', 'nova']);
  const contributions = (Array.isArray(value?.agentContributions) ? value.agentContributions : [])
    .filter((item) => allowedAgents.has(item?.agentId))
    .slice(0, 8)
    .map((item) => ({
      agentId: item.agentId,
      agent: safeText(item.agent, 60),
      role: safeText(item.role, 140),
      finding: safeText(item.finding, 1_500, true),
      evidence: (Array.isArray(item.evidence) ? item.evidence : []).slice(0, 6).map((proof) => safeText(proof, 500)),
      recommendation: safeText(item.recommendation, 1_500, true),
      status: ['done', 'review', 'blocked'].includes(item.status) ? item.status : 'review',
    }));
  if (new Set(contributions.map((item) => item.agentId)).size !== 8) throw new Error('director_contributions_incomplete');
  return {
    executiveSummary: safeText(value?.executiveSummary, 2_000, true),
    recommendedAngle: safeText(value?.recommendedAngle, 1_000, true),
    valuePromise: safeText(value?.valuePromise, 1_000, true),
    targetAudienceReasoning: safeText(value?.targetAudienceReasoning, 1_500, true),
    hypothesis: safeText(value?.hypothesis, 2_000, true),
    ctaGuidance: safeText(value?.ctaGuidance, 1_000, true),
    copyConstraints: (Array.isArray(value?.copyConstraints) ? value.copyConstraints : []).slice(0, 12).map((item) => safeText(item, 500)),
    evidenceUsed: (Array.isArray(value?.evidenceUsed) ? value.evidenceUsed : []).slice(0, 12).map((item) => safeText(item, 500)),
    agentContributions: contributions,
  };
}

async function openAIJsonRequest({ apiKey, schema, schemaName, system, user, maxOutputTokens = 5_000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: directorModel(),
        store: false,
        reasoning: { effort: 'medium' },
        text: {
          verbosity: 'medium',
          format: { type: 'json_schema', name: schemaName, strict: true, schema },
        },
        max_output_tokens: maxOutputTokens,
        input: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(providerError('openai', response.status));
    return { value: JSON.parse(extractOutputText(payload)), payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateDirectorBrief(context, apiKey) {
  const result = await openAIJsonRequest({
    apiKey,
    schema: directorBriefSchema,
    schemaName: 'email_division_director_brief',
    system: directorPrompt(),
    user: `Voici le snapshot agrégé MailerLite autorisé. Construis le brief de direction.\n${JSON.stringify(context)}`,
    maxOutputTokens: 5_500,
  });
  return {
    brief: normalizeDirectorBrief(result.value),
    model: result.payload.model || directorModel(),
    responseId: result.payload.id || null,
    usage: result.payload.usage || null,
  };
}

async function reviewWithOpenAI({ context, brief, artifact, apiKey }) {
  const result = await openAIJsonRequest({
    apiKey,
    schema: directorReviewSchema,
    schemaName: 'email_division_director_review',
    system: directorReviewPrompt(),
    user: `PREUVES AGRÉGÉES\n${JSON.stringify(context)}\n\nBRIEF DE NOVA\n${JSON.stringify(brief)}\n\nBROUILLON DE LÉO\n${JSON.stringify(artifact)}`,
    maxOutputTokens: 3_500,
  });
  return {
    review: {
      ...normalizeQa(result.value),
      directorDecision: ['submit_to_sonny', 'return_to_writer', 'block'].includes(result.value?.directorDecision)
        ? result.value.directorDecision : 'return_to_writer',
      rationale: safeText(result.value?.rationale, 1_500, true),
    },
    model: result.payload.model || directorModel(),
    responseId: result.payload.id || null,
    usage: result.payload.usage || null,
  };
}

async function generateWithOpenAI(context, apiKey) {
  const result = await openAIJsonRequest({
    apiKey,
    schema: runSchema,
    schemaName: 'email_division_broadcast_run',
    system: systemPrompt(),
    user: `Voici le snapshot agrégé MailerLite. Prépare le prochain broadcast de valeur.\n${JSON.stringify(context)}`,
    maxOutputTokens: 7_500,
  });
  return {
    artifact: normalizeArtifact(result.value),
    provider: 'openai',
    model: result.payload.model || directorModel(),
    responseId: result.payload.id || null,
    usage: result.payload.usage || null,
  };
}

function anthropicSchema(value) {
  if (Array.isArray(value)) return value.map(anthropicSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['minimum', 'maximum', 'minItems', 'maxItems'].includes(key))
    .map(([key, item]) => [key, anthropicSchema(item)]));
}

async function generateWithAnthropic(context, apiKey, directorBrief = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  const model = writerModel();
  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 12_000,
        system: directorBrief ? writerPrompt() : systemPrompt(),
        messages: [{
          role: 'user',
          content: directorBrief
            ? `DONNÉES AGRÉGÉES AUTORISÉES\n${JSON.stringify(context)}\n\nBRIEF DE NOVA (OPENAI)\n${JSON.stringify(directorBrief)}\n\nRédige maintenant le dossier complet et l'email.`
            : `Voici le snapshot agrégé MailerLite. Prépare le prochain broadcast de valeur.\n${JSON.stringify(context)}`,
        }],
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: anthropicSchema(runSchema) },
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(providerError('anthropic', response.status));
    if (payload.stop_reason === 'refusal') throw new Error('anthropic_refusal');
    if (payload.stop_reason === 'max_tokens') throw new Error('anthropic_output_truncated');
    const output = (payload.content || []).find((item) => item?.type === 'text')?.text;
    if (!output) throw new Error('anthropic_output_missing');
    return {
      artifact: normalizeArtifact(JSON.parse(output)),
      provider: 'anthropic',
      model: payload.model || model,
      responseId: payload.id || null,
      usage: payload.usage || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateArtifact(context, onPhase = async () => {}) {
  const openaiKey = openAIDirectorKey();
  const anthropicKey = anthropicWriterKey();
  if (openaiKey && anthropicKey) {
    await onPhase('director');
    const direction = await generateDirectorBrief(context, openaiKey);
    await onPhase('writer');
    const writing = await generateWithAnthropic(context, anthropicKey, direction.brief);
    await onPhase('review');
    const control = await reviewWithOpenAI({ context, brief: direction.brief, artifact: writing.artifact, apiKey: openaiKey });
    return {
      artifact: { ...writing.artifact, qa: normalizeQa(control.review) },
      provider: 'openai+anthropic',
      model: `${direction.model} → ${writing.model} → ${control.model}`,
      responseId: { director: direction.responseId, writer: writing.responseId, review: control.responseId },
      usage: { director: direction.usage, writer: writing.usage, review: control.usage },
      directorBrief: direction.brief,
      directorReview: control.review,
      orchestration: {
        director: { provider: 'openai', model: direction.model },
        writer: { provider: 'anthropic', model: writing.model },
        finalReview: { provider: 'openai', model: control.model },
      },
    };
  }
  if (openaiKey) {
    await onPhase('director');
    return generateWithOpenAI(context, openaiKey);
  }
  if (anthropicKey) {
    await onPhase('writer');
    return generateWithAnthropic(context, anthropicKey);
  }
  throw new Error('ai_provider_not_configured');
}

export async function executeBroadcastRun() {
  const lockToken = randomUUID();
  if (!(await acquireRunLock(lockToken))) throw new Error('agent_run_already_in_progress');
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const hasDirector = Boolean(openAIDirectorKey());
  const hasWriter = Boolean(anthropicWriterKey());
  let run = {
    id,
    type: 'broadcast-value',
    analysisVersion: EMAIL_INTELLIGENCE_VERSION,
    status: 'running',
    startedAt,
    finishedAt: null,
    provider: hasDirector && hasWriter ? 'openai+anthropic' : hasDirector ? 'openai' : 'anthropic',
    model: hasDirector && hasWriter ? `${directorModel()} → ${writerModel()} → ${directorModel()}` : hasDirector ? directorModel() : writerModel(),
    safety: { mailerliteWrite: false, mailerliteSend: false, audienceSelected: false, humanApprovalRequired: true },
    stages: [
      { id: 'scan', label: 'Scan agrégé MailerLite', status: 'running' },
      { id: 'director', label: 'Direction Nova · OpenAI', status: hasDirector ? 'queued' : 'skipped' },
      { id: 'writer', label: 'Rédaction Léo · Claude', status: hasWriter ? 'queued' : 'skipped' },
      { id: 'review', label: 'Contrôle final Nova · OpenAI', status: hasDirector && hasWriter ? 'queued' : 'skipped' },
      { id: 'human', label: 'Validation Sonny', status: 'queued' },
    ],
  };
  await saveRun(run);
  try {
    const overview = await loadOverview(String(process.env.MAILERLITE_API_KEY || '').trim());
    const context = compactOverview(overview);
    run = {
      ...run,
      sourceSnapshot: { generatedAt: context.generatedAt, metrics: context.metrics },
      stages: run.stages.map((stage) => stage.id === 'scan' ? { ...stage, status: 'done' } : stage),
    };
    await saveRun(run);
    const phaseOrder = ['director', 'writer', 'review'];
    const generated = await generateArtifact(context, async (phase) => {
      const activeIndex = phaseOrder.indexOf(phase);
      run = {
        ...run,
        stages: run.stages.map((stage) => {
          const index = phaseOrder.indexOf(stage.id);
          if (index < 0 || stage.status === 'skipped') return stage;
          if (index < activeIndex) return { ...stage, status: 'done' };
          if (index === activeIndex) return { ...stage, status: 'running' };
          return { ...stage, status: 'queued' };
        }),
      };
      await saveRun(run);
    });
    run = {
      ...run,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      model: generated.model,
      provider: generated.provider,
      responseId: generated.responseId,
      usage: generated.usage,
      artifact: generated.artifact,
      directorBrief: generated.directorBrief || null,
      directorReview: generated.directorReview || null,
      orchestration: generated.orchestration || null,
      stages: run.stages.map((stage) => (
        stage.id === 'human' ? { ...stage, status: 'review' }
          : stage.status === 'skipped' ? stage : { ...stage, status: 'done' }
      )),
    };
    await saveRun(run);
    return run;
  } catch (error) {
    run = {
      ...run,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: safeText(error?.message, 300),
      stages: run.stages.map((stage) => stage.status === 'running' ? { ...stage, status: 'blocked' } : stage),
    };
    await saveRun(run).catch(() => {});
    throw error;
  } finally {
    await releaseRunLock(lockToken).catch(() => {});
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!getSessionFromRequest(req) && !isTrustedLocalDevelopment(req)) return json(401, { error: 'authentication_required' });
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const run = url.searchParams.get('id') ? await getRun(safeText(url.searchParams.get('id'), 80)) : await getLatestRun();
      const workspace = await getBroadcastWorkspace();
      const runIsCurrent = !run || run.analysisVersion === EMAIL_INTELLIGENCE_VERSION;
      const workspaceIsCurrent = !workspace || workspace.intelligenceVersion === EMAIL_INTELLIGENCE_VERSION;
      return json(200, {
        latestRun: runIsCurrent ? run : null,
        workspace: workspaceIsCurrent ? workspace : null,
        intelligenceVersion: EMAIL_INTELLIGENCE_VERSION,
        intelligenceResetRequired: !runIsCurrent || !workspaceIsCurrent,
        durable: true,
        aiCapabilities: { directorOpenAI: Boolean(openAIDirectorKey()), writerClaude: Boolean(anthropicWriterKey()) },
        mailerliteWritePerformed: false,
      });
    }
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', allowed: ['GET', 'POST'] });
    const body = await req.json().catch(() => ({}));
    if (body.operation === 'save_workspace') {
      const workspace = sanitizeWorkspace(body.workspace);
      await saveBroadcastWorkspace(workspace);
      return json(200, { workspace, durable: true, mailerliteWritePerformed: false });
    }
    if (body.operation !== 'start_broadcast') return json(400, { error: 'unsupported_operation' });
    const latest = await getLatestRun();
    const latestAt = new Date(latest?.startedAt || 0).getTime();
    if (!body.force && latest?.analysisVersion === EMAIL_INTELLIGENCE_VERSION && latest?.status === 'completed' && Date.now() - latestAt < RUN_COOLDOWN_MS) {
      return json(200, { run: latest, reused: true, mailerliteWritePerformed: false });
    }
    if (!String(process.env.MAILERLITE_API_KEY || '').trim()) return json(503, { error: 'mailerlite_not_configured' });
    const workerUrl = new URL('/.netlify/functions/admin-email-marketing-agent-run-worker-background', req.url);
    const workerHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const cookie = req.headers.get('cookie');
    if (cookie) workerHeaders.Cookie = cookie;
    const workerResponse = await fetch(workerUrl, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify({ operation: 'execute_broadcast' }),
    });
    if (!workerResponse.ok) throw new Error(`background_worker_${workerResponse.status}`);
    return json(202, { accepted: true, reused: false, mailerliteWritePerformed: false });
  } catch (error) {
    const message = safeText(error?.message, 300);
    console.error('[admin-email-marketing-agent-runs] failed', message);
    if (message === 'agent_run_already_in_progress') return json(409, { error: message });
    if (message === 'email_division_storage_not_configured') return json(503, { error: message });
    if (message === 'ai_provider_not_configured') return json(503, { error: message });
    return json(502, { error: 'agent_run_failed', detail: message, mailerliteWritePerformed: false });
  }
};
