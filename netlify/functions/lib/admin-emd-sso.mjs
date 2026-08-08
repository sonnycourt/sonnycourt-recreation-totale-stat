import crypto from 'node:crypto';

const HANDOFF_TTL_MS = 30 * 1000;

function b64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(value) {
  const padding = value.length % 4 ? '='.repeat(4 - (value.length % 4)) : '';
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + padding, 'base64');
}

function handoffSecret(secret) {
  return crypto.createHash('sha256').update(`admin-emd-sso|${secret}`).digest();
}

export function signEmdHandoff(secret, sessionExp) {
  const now = Date.now();
  const payload = b64url(JSON.stringify({
    aud: 'emd.sonnycourt.com',
    iat: now,
    exp: Math.min(now + HANDOFF_TTL_MS, Number(sessionExp) || now),
    sessionExp: Number(sessionExp) || now,
    nonce: crypto.randomBytes(16).toString('hex'),
  }));
  const signature = crypto.createHmac('sha256', handoffSecret(secret)).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export function verifyEmdHandoff(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^[a-f0-9]{64}$/i.test(signature)) return null;
  const expected = crypto.createHmac('sha256', handoffSecret(secret)).update(payload).digest('hex');
  try {
    const left = Buffer.from(signature, 'hex');
    const right = Buffer.from(expected, 'hex');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(b64urlDecode(payload).toString('utf8'));
    if (data?.aud !== 'emd.sonnycourt.com') return null;
    if (!Number.isFinite(data.exp) || data.exp < Date.now()) return null;
    if (!Number.isFinite(data.sessionExp) || data.sessionExp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
