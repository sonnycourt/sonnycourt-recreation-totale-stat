// Aggregate audience measurement: no cookies, storage, visitor ID or attribution.
export function initDeltaPageviews(doc = document, win = window) {
  if (!['sonnycourt.com', 'www.sonnycourt.com'].includes(win.location.hostname) ||
      !/^\/delta-vision\/?$/.test(win.location.pathname) || win.navigator.webdriver ||
      new URLSearchParams(win.location.hash.slice(1)).has('gift') || win.__dvPageviewSent) return;
  function count() {
    if (doc.visibilityState !== 'visible' || win.__dvPageviewSent) return;
    win.__dvPageviewSent = true;
    doc.removeEventListener('visibilitychange', count);
    // No retries: an ambiguous response must not produce duplicate counts.
    try {
      win.fetch('/.netlify/functions/delta-vision-pageview', {
        method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'text/plain' }, body: 'view', keepalive: true,
      }).catch(() => {});
    } catch { /* Measurement must never block the page. */ }
  }
  doc.addEventListener('visibilitychange', count);
  count();
}
