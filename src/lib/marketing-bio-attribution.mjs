// Propagate only campaign fields to the two programme choices, never identity,
// checkout tokens or a caller-supplied destination URL.
export function bioChoiceUrl(href, search, origin = 'https://sonnycourt.com') {
  const target = new URL(href, origin), incoming = new URLSearchParams(search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = incoming.get(key);
    if (value && /^[a-zA-Z0-9_.-]{1,160}$/.test(value)) target.searchParams.set(key, value);
  }
  const code = incoming.get('sc_link');
  if (/^[a-f0-9]{12}$/.test(code || '')) {
    target.searchParams.set('sc_link', code);
    target.searchParams.set('utm_content', code);
  }
  for (const key of ['fbclid', 'ttclid', 'gclid', 'msclkid']) {
    const value = incoming.get(key);
    if (value && /^[a-zA-Z0-9_.-]{1,512}$/.test(value)) target.searchParams.set(key, value);
  }
  return target.pathname + target.search;
}
