import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import {
  getAutonomySnapshot,
  updateAutonomyEnabled,
} from './lib/email-division-autonomy.mjs';

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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!getSessionFromRequest(req) && !isTrustedLocalDevelopment(req)) return json(401, { error: 'authentication_required' });
  try {
    if (req.method === 'GET') return json(200, await getAutonomySnapshot());
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', allowed: ['GET', 'POST'] });

    const body = await req.json().catch(() => ({}));
    if (body.operation === 'set_enabled') {
      if (typeof body.enabled !== 'boolean') return json(400, { error: 'enabled_boolean_required' });
      const state = await updateAutonomyEnabled(body.enabled);
      return json(200, { state, mailerliteWritePerformed: false });
    }
    if (body.operation !== 'run_now') return json(400, { error: 'unsupported_operation' });

    const workerUrl = new URL('/.netlify/functions/admin-email-marketing-autonomy-worker-background', req.url);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const cookie = req.headers.get('cookie');
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ operation: 'execute_daily_pulse', trigger: 'manual', force: true }),
    });
    if (!response.ok) throw new Error(`autonomy_worker_${response.status}`);
    return json(202, { accepted: true, mailerliteWritePerformed: false, mailerliteSendPerformed: false });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 160);
    console.error('[admin-email-marketing-autonomy] failed', message);
    if (message === 'email_division_storage_not_configured') return json(503, { error: message });
    return json(502, { error: 'autonomy_request_failed', mailerliteWritePerformed: false, mailerliteSendPerformed: false });
  }
};
