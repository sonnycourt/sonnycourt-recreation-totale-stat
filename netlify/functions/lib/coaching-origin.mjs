export const DEFAULT_COACHING_APP_ORIGIN = 'https://coaching.sonnycourt.com';

export function coachingAppOrigin(environment = process.env) {
  const candidate = String(environment.COACHING_APP_ORIGIN || DEFAULT_COACHING_APP_ORIGIN).trim().replace(/\/$/, '');
  try {
    const url = new URL(candidate);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('invalid_protocol');
    return url.origin;
  } catch {
    return DEFAULT_COACHING_APP_ORIGIN;
  }
}

export function coachingAppUrl(pathname = '/', environment = process.env) {
  const path = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
  return `${coachingAppOrigin(environment)}${path}`;
}
