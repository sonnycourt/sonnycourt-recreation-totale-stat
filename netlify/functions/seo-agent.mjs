import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import {
  SEO_AGENTS,
  SEO_MODEL,
  SEO_SHARED_INSTRUCTIONS,
  publicAgentProfiles,
} from './lib/seo-agents.mjs';

const MAX_MISSION_CHARS = 10_000;
const MAX_CONTEXT_CHARS = 20_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();

function seoAgentsEnabled() {
  return process.env.SEO_AGENTS_ENABLED === 'true';
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function clientKey(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'admin'
  );
}

function isRateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

function cleanText(value, maxChars) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxChars);
}

function extractAnswer(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  return (response?.output || [])
    .filter((item) => item?.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function extractSources(response) {
  const seen = new Set();
  const sources = [];
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      for (const annotation of part?.annotations || []) {
        if (annotation?.type !== 'url_citation' || !annotation.url || seen.has(annotation.url)) continue;
        seen.add(annotation.url);
        sources.push({
          title: cleanText(annotation.title, 180) || annotation.url,
          url: annotation.url,
        });
      }
    }
  }
  return sources.slice(0, 12);
}

function safeUsage(usage) {
  return {
    inputTokens: Number(usage?.input_tokens || 0),
    outputTokens: Number(usage?.output_tokens || 0),
    totalTokens: Number(usage?.total_tokens || 0),
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(405, { error: 'Méthode non autorisée' });
  }

  if (!getSessionFromRequest(req)) {
    return json(401, { error: 'Connexion administrateur requise', code: 'AUTH_REQUIRED' });
  }

  const enabled = seoAgentsEnabled();
  const apiKey = process.env.OPENAI_API_KEY;
  if (req.method === 'GET') {
    return json(enabled && !apiKey ? 503 : 200, {
      ready: enabled && Boolean(apiKey),
      paused: !enabled,
      model: SEO_MODEL,
      agents: publicAgentProfiles(),
      publicationEnabled: false,
      error: !enabled
        ? 'Division SEO en pause — aucun appel OpenAI autorisé'
        : apiKey ? null : 'Clé OpenAI manquante côté serveur',
    });
  }

  if (!enabled) {
    return json(423, {
      error: 'Division SEO en pause — aucun crédit OpenAI ne peut être dépensé',
      code: 'SEO_AGENTS_PAUSED',
      paused: true,
    });
  }
  if (!apiKey) {
    return json(503, { error: 'OpenAI n’est pas configuré côté serveur', code: 'OPENAI_NOT_CONFIGURED' });
  }
  if (isRateLimited(req)) {
    return json(429, {
      error: 'Limite de sécurité atteinte. Réessaie dans une heure.',
      code: 'RATE_LIMITED',
    });
  }

  const body = await req.json().catch(() => ({}));
  const agentId = typeof body.agentId === 'string' ? body.agentId : '';
  const agent = SEO_AGENTS[agentId];
  if (!agent) return json(400, { error: 'Agent inconnu' });

  const mission = cleanText(body.mission, MAX_MISSION_CHARS);
  const context = cleanText(body.context, MAX_CONTEXT_CHARS);
  if (!mission) return json(400, { error: 'Décris la mission à confier à l’agent' });

  const userInput = [
    `MISSION CONFIEE A ${agent.name.toUpperCase()} :\n${mission}`,
    context ? `CONTEXTE FOURNI PAR SONNY :\n${context}` : '',
    'Réponds comme le spécialiste désigné, avec un livrable concret et vérifiable.',
  ].filter(Boolean).join('\n\n');

  const payload = {
    model: SEO_MODEL,
    instructions: `${SEO_SHARED_INSTRUCTIONS}\n\nPROFIL ACTIF — ${agent.name}, ${agent.role}\n${agent.mission}`,
    input: userInput,
    reasoning: {
      effort: agent.reasoning,
      context: 'current_turn',
    },
    text: { verbosity: 'medium' },
    max_output_tokens: 4_000,
    store: false,
    metadata: {
      application: 'sonnycourt-seo-division',
      agent_id: agentId,
    },
  };

  if (agent.webSearch) {
    payload.tools = [{ type: 'web_search' }];
    payload.tool_choice = 'auto';
  }

  let openaiResponse;
  try {
    openaiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(115_000),
    });
  } catch (error) {
    console.error('seo-agent OpenAI network error:', error?.message || error);
    return json(503, { error: 'OpenAI est momentanément inaccessible. Réessaie.', code: 'OPENAI_UNAVAILABLE' });
  }

  const responseData = await openaiResponse.json().catch(() => ({}));
  if (!openaiResponse.ok) {
    const requestId = openaiResponse.headers.get('x-request-id') || null;
    console.error('seo-agent OpenAI error:', openaiResponse.status, requestId, responseData?.error?.code || 'unknown');
    if (openaiResponse.status === 429) {
      return json(503, { error: 'OpenAI est très sollicité. Réessaie dans un instant.', code: 'OPENAI_BUSY' });
    }
    if (openaiResponse.status === 401 || openaiResponse.status === 403) {
      return json(503, { error: 'La connexion OpenAI doit être vérifiée.', code: 'OPENAI_AUTH' });
    }
    return json(502, { error: 'La mission n’a pas pu être terminée.', code: 'OPENAI_ERROR' });
  }

  const answer = extractAnswer(responseData);
  if (!answer) return json(502, { error: 'OpenAI a renvoyé une réponse vide. Réessaie.' });

  return json(200, {
    ok: true,
    model: SEO_MODEL,
    agent: { id: agentId, name: agent.name, role: agent.role },
    answer,
    sources: extractSources(responseData),
    usage: safeUsage(responseData.usage),
    publicationEnabled: false,
  });
};
