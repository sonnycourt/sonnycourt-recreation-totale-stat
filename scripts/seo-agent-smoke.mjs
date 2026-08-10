import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'seo-agent-smoke-service-role';
process.env.OPENAI_API_KEY = 'seo-agent-smoke-openai-key';
process.env.SEO_AGENTS_ENABLED = 'false';

const { signSessionToken } = await import('../netlify/functions/lib/admin-es2-crypto.mjs');
const { getAdminEs2CookieSecret } = await import('../netlify/functions/lib/admin-es2-session-secret.mjs');
const { default: seoAgent } = await import('../netlify/functions/seo-agent.mjs');

const unauthorized = await seoAgent(new Request('https://seo.example/.netlify/functions/seo-agent'));
assert.equal(unauthorized.status, 401, 'The endpoint must reject anonymous requests');

const token = signSessionToken(getAdminEs2CookieSecret(), 60_000);
const cookie = `admin_es2_session=${encodeURIComponent(token)}`;
const authenticatedHeaders = { Cookie: cookie };

const pausedStatusResponse = await seoAgent(new Request('https://seo.example/.netlify/functions/seo-agent', {
  headers: authenticatedHeaders,
}));
assert.equal(pausedStatusResponse.status, 200);
const pausedStatus = await pausedStatusResponse.json();
assert.equal(pausedStatus.ready, false);
assert.equal(pausedStatus.paused, true);

let openAiCalledWhilePaused = false;
globalThis.fetch = async () => {
  openAiCalledWhilePaused = true;
  throw new Error('OpenAI must not be called while the SEO division is paused');
};
const pausedMissionResponse = await seoAgent(new Request('https://seo.example/.netlify/functions/seo-agent', {
  method: 'POST',
  headers: { ...authenticatedHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentId: 'basile', mission: 'Cette mission doit rester bloquée.' }),
}));
assert.equal(pausedMissionResponse.status, 423);
assert.equal(openAiCalledWhilePaused, false);

process.env.SEO_AGENTS_ENABLED = 'true';
const statusResponse = await seoAgent(new Request('https://seo.example/.netlify/functions/seo-agent', {
  headers: authenticatedHeaders,
}));
assert.equal(statusResponse.status, 200);
const status = await statusResponse.json();
assert.equal(status.ready, true);
assert.equal(status.paused, false);
assert.equal(status.model, 'gpt-5.6-sol');
assert.equal(status.agents.length, 8);
assert.equal(status.publicationEnabled, false);

let latestPayload = null;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(options.headers.Authorization, 'Bearer seo-agent-smoke-openai-key');
  latestPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    output_text: 'Livrable de test',
    output: [{
      type: 'message',
      content: [{
        type: 'output_text',
        text: 'Livrable de test',
        annotations: [{ type: 'url_citation', title: 'Source primaire', url: 'https://example.com/source' }],
      }],
    }],
    usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const basileResponse = await seoAgent(new Request('https://seo.example/.netlify/functions/seo-agent', {
  method: 'POST',
  headers: { ...authenticatedHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentId: 'basile', mission: 'Trouve des opportunités françaises.' }),
}));
assert.equal(basileResponse.status, 200);
const basile = await basileResponse.json();
assert.equal(basile.answer, 'Livrable de test');
assert.equal(basile.sources.length, 1);
assert.equal(latestPayload.model, 'gpt-5.6-sol');
assert.equal(latestPayload.reasoning.effort, 'high');
assert.deepEqual(latestPayload.tools, [{ type: 'web_search' }]);
assert.equal(latestPayload.store, false);

const numaResponse = await seoAgent(new Request('https://seo.example/.netlify/functions/seo-agent', {
  method: 'POST',
  headers: { ...authenticatedHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ agentId: 'numa', mission: 'Rappelle le catalogue MVP.' }),
}));
assert.equal(numaResponse.status, 200);
assert.equal(latestPayload.model, 'gpt-5.6-sol');
assert.equal(latestPayload.reasoning.effort, 'medium');
assert.equal(latestPayload.tools, undefined);
assert.match(latestPayload.instructions, /exactement deux destinations/);

console.log('SEO agent smoke test passed: pause lock, auth, 8 profiles, GPT-5.6 Sol routing and tool boundaries.');
