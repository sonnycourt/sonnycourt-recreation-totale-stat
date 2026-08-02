export const COACHING_APP_HOST = 'coaching.sonnycourt.com';

export function isCoachingAppHost(hostname = typeof window !== 'undefined' ? window.location.hostname : '') {
  return String(hostname || '').trim().toLowerCase().split(':')[0] === COACHING_APP_HOST;
}

export function coachingUrl(value, hostname = typeof window !== 'undefined' ? window.location.hostname : '') {
  const target = String(value || '');
  if (!target || target.startsWith('#') || !isCoachingAppHost(hostname)) return target;

  const match = target.match(/^([^?#]*)([?#].*)?$/);
  if (!match) return target;
  const pathname = match[1] || '/';
  const suffix = match[2] || '';

  if (pathname === '/coaching' || pathname === '/coaching/') return `/${suffix}`;
  if (pathname === '/coach-console' || pathname === '/coach-console/') return `/coach${suffix}`;
  if (pathname.startsWith('/coaching/')) return `${pathname.slice('/coaching'.length)}${suffix}`;
  return target;
}

export function rewriteCoachingLinks(root = typeof document !== 'undefined' ? document : null) {
  if (!root || !isCoachingAppHost()) return;
  root.querySelectorAll('a[href], [data-demo-link]').forEach((node) => {
    for (const attribute of ['href', 'data-demo-link']) {
      if (!node.hasAttribute(attribute)) continue;
      node.setAttribute(attribute, coachingUrl(node.getAttribute(attribute)));
    }
  });
}

if (typeof document !== 'undefined') queueMicrotask(() => rewriteCoachingLinks(document));
