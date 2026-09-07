import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

export function assertLocalDeployDependencies(root) {
  const modules = join(root, 'node_modules');
  // Netlify's NFT packager can archive this link instead of its contents.
  // The link works locally but points outside the deployed Lambda archive.
  if (!existsSync(modules) || !lstatSync(modules).isDirectory() || lstatSync(modules).isSymbolicLink()) {
    throw new Error('Déploiement refusé : node_modules doit être un vrai dossier local, pas un lien symbolique. Installe les dépendances dans ce worktree.');
  }
}

// These requests stop at method/input validation, before any database lookup,
// registration, tracking event, email, SMS or payment operation.
export const MC2_STARTUP_PROBES = Object.freeze([
  { name: 'register-mc2', method: 'GET', status: 405, body: { error: 'Method not allowed' } },
  { name: 'register-mc2', method: 'POST', status: 400, body: { error: 'Paramètres manquants' } },
  { name: 'check-mc2-eligibility', method: 'GET', status: 405, body: { error: 'Method not allowed' } },
  { name: 'track-mc2-optin', method: 'GET', status: 405, body: { error: 'Method not allowed' } },
  { name: 'track-mc2-event', method: 'GET', status: 405, body: { error: 'Method not allowed' } },
  { name: 'mc2-replay-track', method: 'GET', status: 405, body: { error: 'Méthode non autorisée' } },
  { name: 'mc2-replay-enter', method: 'GET', status: 404, body: 'Lien invalide.' },
]);

export async function assertMc2FunctionStartup(baseUrl, fetchImpl = fetch) {
  const errors = (await Promise.all(MC2_STARTUP_PROBES.map(async (probe) => {
    try {
      const response = await fetchImpl(new URL(`/.netlify/functions/${probe.name}`, baseUrl), {
        method: probe.method,
        headers: { 'cache-control': 'no-cache', 'content-type': 'application/json' },
        ...(probe.method === 'POST' ? { body: '{}' } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
      const text = await response.text();
      const expected = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body);
      if (response.status !== probe.status || text !== expected) {
        return `${probe.name} (${probe.method}) : réponse inattendue ${response.status}, attendue ${probe.status}`;
      }
    } catch (error) {
      return `${probe.name} (${probe.method}) : ${error.message}`;
    }
    return null;
  }))).filter(Boolean);
  if (errors.length) throw new Error(`Démarrage des fonctions MC2 invalide :\n- ${errors.join('\n- ')}`);
  console.log('✅ Démarrage des fonctions MC2 vérifié, sans inscription ni envoi test.');
}
