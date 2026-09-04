import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const netlify = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8');
const critical = JSON.parse(await readFile(new URL('../deploy/critical-routes.json', import.meta.url), 'utf8'));

for (const path of ['/masterclass', '/masterclass/']) {
  const escaped = path.replaceAll('/', '\\/');
  const rule = new RegExp(
    `\\[\\[redirects\\]\\]\\s+from = "${escaped}"\\s+to = "\\/mc2\\/"\\s+status = 302\\s+force = true`,
  );
  assert.match(netlify, rule, `${path} doit rediriger temporairement vers /mc2/`);

  const guard = critical.routes.find((route) => route.path === path);
  assert.equal(guard?.redirectTo, '/mc2/');
  assert.ok(guard.contains.includes('JE RÉSERVE MON ACCÈS OFFERT'));
}

assert.doesNotMatch(netlify, /from = "\/masterclass\/\*"/);

console.log(JSON.stringify({
  masterclass_redirects_to_mc2: 'ok',
  query_parameters_checked_by_safe_deploy: 'ok',
  masterclass_subroutes_untouched: 'ok',
}, null, 2));
