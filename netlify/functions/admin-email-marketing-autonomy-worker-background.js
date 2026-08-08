import crypto from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { executeAutonomyPulse } from './lib/email-division-autonomy.mjs';

function isTrustedLocalDevelopment(req) {
  if (!process.env.NETLIFY_DEV) return false;
  try {
    const hostname = new URL(req.url).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function secureEqual(value, expected) {
  const left = Buffer.from(String(value || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function isScheduledWorkerRequest(req) {
  const configured = String(process.env.EMAIL_DIVISION_AUTONOMY_SECRET || '').trim();
  return configured && secureEqual(req.headers.get('x-email-division-autonomy-secret'), configured);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (!getSessionFromRequest(req) && !isTrustedLocalDevelopment(req) && !isScheduledWorkerRequest(req)) {
    return json(401, { error: 'authentication_required' });
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.operation !== 'execute_daily_pulse') return json(400, { error: 'unsupported_operation' });
    const pulse = await executeAutonomyPulse({
      trigger: body.trigger === 'scheduled' ? 'scheduled' : 'manual',
      force: body.force === true,
    });
    return json(200, {
      completed: true,
      pulseId: pulse.id,
      status: pulse.status,
      mailerliteWritePerformed: false,
      mailerliteSendPerformed: false,
    });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 160);
    console.error('[email-division-autonomy-worker] failed', message);
    if (message === 'autonomy_pulse_already_in_progress') return json(409, { error: message });
    return json(500, { error: 'autonomy_pulse_failed', mailerliteWritePerformed: false, mailerliteSendPerformed: false });
  }
};
