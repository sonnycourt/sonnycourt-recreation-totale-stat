import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalDeployDependencies, assertMc2FunctionStartup, MC2_STARTUP_PROBES } from './lib/deploy-runtime-guards.mjs';

const dir = await mkdtemp(join(tmpdir(), 'mc2-deploy-guard-test-'));
try {
  assert.throws(() => assertLocalDeployDependencies(dir), /vrai dossier local/);
  const shared = join(dir, 'shared');
  await mkdir(shared);
  await symlink(shared, join(dir, 'node_modules'));
  assert.throws(() => assertLocalDeployDependencies(dir), /lien symbolique/);
  await rm(join(dir, 'node_modules'));
  await mkdir(join(dir, 'node_modules'));
  assert.doesNotThrow(() => assertLocalDeployDependencies(dir));
} finally {
  await rm(dir, { recursive: true, force: true });
}

const requests = [];
const healthyFetch = async (url, options) => {
  requests.push({ url, options });
  const probe = MC2_STARTUP_PROBES.find((p) => url.pathname.endsWith('/' + p.name) && p.method === options.method);
  return new Response(typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body), { status: probe.status });
};
await assertMc2FunctionStartup('https://preview.example', healthyFetch);
assert.equal(requests.length, MC2_STARTUP_PROBES.length);
for (const { url, options } of requests) {
  assert.equal(url.search, '');
  assert.equal(options.redirect, 'manual');
  if (options.method === 'POST') assert.equal(options.body, '{}');
  else assert.equal(options.body, undefined);
}
await assert.rejects(assertMc2FunctionStartup('https://preview.example', async () => new Response('Cannot find package stripe', { status: 502 })), /Démarrage des fonctions MC2 invalide/);
await assert.rejects(assertMc2FunctionStartup('https://preview.example', async () => new Response('Wrong body', { status: 405 })), /réponse inattendue/);
await assert.rejects(assertMc2FunctionStartup('https://preview.example', async () => { throw new Error('timeout'); }), /timeout/);

// Execute the real handlers with invalid input. Any external request fails the
// test: the deploy probes must never create a prospect or trigger a message.
const originalFetch = globalThis.fetch;
let externalRequests = 0;
globalThis.fetch = async () => { externalRequests++; throw new Error('External request forbidden in startup probes'); };
try {
  for (const probe of MC2_STARTUP_PROBES) {
    const { default: handler } = await import(`../netlify/functions/${probe.name}.js`);
    const response = await handler(new Request(`https://local.example/.netlify/functions/${probe.name}`, {
      method: probe.method, ...(probe.method === 'POST' ? { body: '{}' } : {}),
    }));
    assert.equal(response.status, probe.status, probe.name);
    assert.equal(await response.text(), typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body), probe.name);
  }
  assert.equal(externalRequests, 0);
} finally { globalThis.fetch = originalFetch; }

const source = await readFile(new URL('./safe-deploy.mjs', import.meta.url), 'utf8');
assert.match(source, /await assertMc2FunctionStartup\(baseUrl\)/);
assert.match(source, /assertLocalDeployDependencies\(root\)/);
assert.ok(source.indexOf('await assertCriticalUrl(preview.deploy_url)') < source.indexOf("netlifyApi('unlockDeploy'"));
console.log('Deploy runtime guards: symlink rejection, startup failures, preview gate, zero external side effects: OK');
