import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'check';
const allowedModes = new Set(['check', 'preview', 'production']);
const config = JSON.parse(
  readFileSync(join(root, 'deploy/critical-routes.json'), 'utf8'),
);
const siteId = config.siteId;
let lockPath = '';
let lockFd = null;

if (!allowedModes.has(mode)) {
  fail('Mode inconnu. Utilise check, preview ou production.');
}
if (!siteId) {
  fail('Le site Netlify protégé n’est pas configuré.');
}

process.env.NETLIFY_SITE_ID = siteId;

function fail(message) {
  console.error(`\n⛔ ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  });
}

function git(args, capture = true) {
  const output = run('git', args, { capture });
  return capture ? output.trim() : '';
}

function netlifyApi(method, data) {
  const output = run(
    'npx',
    ['netlify', 'api', method, '--data', JSON.stringify(data)],
    { capture: true },
  );
  return JSON.parse(output);
}

function acquireProductionLock() {
  const commonDirRaw = git(['rev-parse', '--git-common-dir']);
  const commonDir = realpathSync(resolve(root, commonDirRaw));
  lockPath = join(commonDir, 'sonnycourt-production-deploy.lock');
  try {
    lockFd = openSync(lockPath, 'wx');
    writeFileSync(
      lockFd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          cwd: root,
          branch: git(['branch', '--show-current']),
        },
        null,
        2,
      ),
    );
  } catch {
    fail(
      `Un autre déploiement est déjà en cours (${lockPath}). Rien n'a été publié.`,
    );
  }
}

function releaseProductionLock() {
  if (lockFd !== null) {
    closeSync(lockFd);
    lockFd = null;
  }
  if (lockPath && existsSync(lockPath)) rmSync(lockPath);
}

process.on('exit', releaseProductionLock);
process.on('SIGINT', () => {
  releaseProductionLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseProductionLock();
  process.exit(143);
});

function htmlFileForRoute(routePath) {
  const clean = routePath.replace(/^\/|\/$/g, '');
  const candidates = clean
    ? clean.endsWith('.html')
      ? [join(root, 'dist', clean)]
      : [join(root, 'dist', clean, 'index.html'), join(root, 'dist', `${clean}.html`)]
    : [join(root, 'dist', 'index.html')];
  return candidates.find(existsSync);
}

function assertCriticalBuild() {
  const errors = [];
  for (const route of config.routes) {
    const file = htmlFileForRoute(route.path);
    if (!file) {
      errors.push(`${route.path} n'existe pas dans le build`);
      continue;
    }
    const html = readFileSync(file, 'utf8');
    for (const marker of route.contains) {
      if (!html.includes(marker)) {
        errors.push(`${route.path} a perdu le marqueur : ${marker}`);
      }
    }
  }
  for (const functionPath of config.functions) {
    if (!existsSync(join(root, functionPath))) {
      errors.push(`fonction absente : ${functionPath}`);
    }
  }
  if (errors.length) {
    fail(`Le contrôle anti-régression a échoué :\n- ${errors.join('\n- ')}`);
  }
}

async function assertCriticalUrl(baseUrl) {
  const errors = [];
  for (const route of config.routes) {
    const url = new URL(route.path, baseUrl);
    url.searchParams.set('safe_deploy_check', Date.now().toString());
    const response = await fetch(url, {
      headers: { 'cache-control': 'no-cache' },
      redirect: 'follow',
    });
    const html = await response.text();
    if (!response.ok) {
      errors.push(`${route.path} répond ${response.status}`);
      continue;
    }
    for (const marker of route.contains) {
      if (!html.includes(marker)) {
        errors.push(`${route.path} a perdu le marqueur : ${marker}`);
      }
    }
  }
  if (errors.length) {
    fail(`La preview a échoué au contrôle anti-régression :\n- ${errors.join('\n- ')}`);
  }
}

function assertProductionGitState() {
  const branch = git(['branch', '--show-current']);
  if (branch !== 'main') {
    fail(`La production est interdite depuis "${branch}". Fusionne d'abord dans main.`);
  }
  const status = git(['status', '--porcelain']);
  if (status) {
    fail('Le dossier contient des changements non commités. Production refusée.');
  }
  git(['fetch', 'origin', 'main'], false);
  const local = git(['rev-parse', 'HEAD']);
  const remote = git(['rev-parse', 'origin/main']);
  if (local !== remote) {
    fail('main n’est pas identique à origin/main. Synchronise avant de publier.');
  }
}

function currentProduction() {
  const site = netlifyApi('getSite', { site_id: siteId });
  const deploy = netlifyApi('getDeploy', {
    deploy_id: site.published_deploy.id,
  });
  if (!deploy.locked) {
    fail('La production Netlify n’est pas verrouillée. Arrêt par sécurité.');
  }
  return {
    id: deploy.id,
    url: site.ssl_url || site.url,
    locked: deploy.locked,
  };
}

async function assertNoHistoryRollback(production, candidateCommit) {
  const manifestUrl = new URL(
    '/.well-known/sonnycourt-deploy.json',
    production.url,
  );
  manifestUrl.searchParams.set('t', Date.now().toString());
  const response = await fetch(manifestUrl, {
    headers: { 'cache-control': 'no-cache' },
  });

  if (response.ok) {
    const live = await response.json();
    if (!live.commit) fail('Le manifeste de production est invalide.');
    try {
      git(['merge-base', '--is-ancestor', live.commit, candidateCommit]);
    } catch {
      fail(
        'La nouvelle version ne contient pas la version actuellement en ligne. Retour en arrière bloqué.',
      );
    }
    return;
  }

  if (production.id !== config.bootstrapProductionDeployId) {
    fail(
      `Production inconnue (${production.id}) sans manifeste sécurisé. Publication bloquée.`,
    );
  }
}

function build(baseDeployId) {
  run('npm', ['run', 'build']);
  assertCriticalBuild();
  const manifestDir = join(root, 'dist/.well-known');
  mkdirSync(manifestDir, { recursive: true });
  const commit = git(['rev-parse', 'HEAD']);
  writeFileSync(
    join(manifestDir, 'sonnycourt-deploy.json'),
    JSON.stringify(
      {
        commit,
        parentProductionDeployId: baseDeployId || null,
        builtAt: new Date().toISOString(),
        mode,
      },
      null,
      2,
    ),
  );
}

function deployPreview() {
  const output = run(
    'npx',
    [
      'netlify',
      'deploy',
      '--dir=dist',
      '--functions=netlify/functions',
      '--no-build',
      '--skip-functions-cache',
      '--json',
      '--message',
      `Safe preview ${git(['rev-parse', '--short', 'HEAD'])}`,
    ],
    { capture: true },
  );
  return JSON.parse(output);
}

async function main() {
  if (mode === 'production') {
    acquireProductionLock();
    assertProductionGitState();
    const production = currentProduction();
    const commit = git(['rev-parse', 'HEAD']);
    await assertNoHistoryRollback(production, commit);
    build(production.id);

    console.log('\n🔎 Création et contrôle de la preview obligatoire…');
    const preview = deployPreview();
    await assertCriticalUrl(preview.deploy_url);

    let unlocked = false;
    let published = null;
    try {
      netlifyApi('unlockDeploy', { deploy_id: production.id });
      unlocked = true;
      const output = run(
        'npx',
        [
          'netlify',
          'deploy',
          '--prod',
          '--dir=dist',
          '--functions=netlify/functions',
          '--no-build',
          '--skip-functions-cache',
          '--json',
          '--message',
          `Safe production ${git(['rev-parse', '--short', 'HEAD'])}`,
        ],
        { capture: true },
      );
      published = JSON.parse(output);
      await assertCriticalUrl(published.deploy_url || production.url);
      netlifyApi('lockDeploy', { deploy_id: published.deploy_id });
      unlocked = false;
      console.log(`\n✅ Production publiée et verrouillée : ${published.deploy_url}\n`);
    } finally {
      if (unlocked) {
        netlifyApi('lockDeploy', {
          deploy_id: published?.deploy_id || production.id,
        });
      }
    }
    return;
  }

  build(null);
  if (mode === 'check') {
    console.log('\n✅ Build vérifié. Aucune publication effectuée.\n');
    return;
  }

  const preview = deployPreview();
  await assertCriticalUrl(preview.deploy_url);
  console.log(`\n✅ Preview vérifiée : ${preview.deploy_url}\n`);
}

main().catch((error) => {
  fail(error?.message || String(error));
});
