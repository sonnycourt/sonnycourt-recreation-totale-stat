import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { executeBroadcastRun } from './admin-email-marketing-agent-runs.js';

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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (!getSessionFromRequest(req) && !isTrustedLocalDevelopment(req)) return json(401, { error: 'authentication_required' });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.operation !== 'execute_broadcast') return json(400, { error: 'unsupported_operation' });
    const run = await executeBroadcastRun();
    return json(200, { completed: true, runId: run.id, mailerliteWritePerformed: false });
  } catch (error) {
    console.error('[email-division-background] failed', String(error?.message || error).slice(0, 300));
    return json(500, { error: 'background_run_failed', mailerliteWritePerformed: false });
  }
};
