const ENDPOINT = '/.netlify/functions/marketing-link-arrival';
const CONSENT_AGE = 180 * 86400000;
export function hasStatisticsConsent(doc, win) {
  try {
    const cookie = doc.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cookieConsent='));
    if (cookie) {
      const value = JSON.parse(decodeURIComponent(cookie.slice(14)));
      if (Date.now() - value.timestamp < CONSENT_AGE) return value.statistics === true;
    }
    const delta = JSON.parse(win.localStorage.getItem('dv_analytics_consent_v1') || 'null');
    return !!delta && delta.allowed === true && Date.now() - delta.at < CONSENT_AGE;
  } catch { return false; }
}
export function initMarketingAttribution(doc = document, win = window) {
  if (win.__scMarketingStarted) return;
  win.__scMarketingStarted = true;
  if (!['sonnycourt.com','www.sonnycourt.com'].includes(win.location.hostname) || win.__MC2_PREVIEW_ONLY__ || win.__mc2DraftX) return;
  const params = new URLSearchParams(win.location.search);
  if (params.has('preview') || params.has('safe_deploy_check')) return;
  const code = params.get('sc_link');
  const validCode = /^[a-f0-9]{12}$/.test(code || '');
  if (!win.crypto?.randomUUID) return;
  const eventId = win.crypto.randomUUID();
  let receipt = '', attempts = 0, sending = false, timer;
  let consent = hasStatisticsConsent(doc, win);
  // In-memory only: no identity or history is persisted by this script.
  win.__scMarketingReceipt = () => receipt;
  win.__scMarketingStatisticsConsent = () => hasStatisticsConsent(doc, win);
  const post = body => win.fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(4000) });
  async function record() {
    if (!validCode || doc.hidden || receipt || sending || attempts >= 3) return;
    sending = true; attempts++;
    const sentConsent = hasStatisticsConsent(doc, win);
    try {
      const res = await post({ code, event_id: eventId, path: win.location.pathname, visible: true, statistics_consent: sentConsent });
      const data = await res.json();
      if (res.ok && typeof data.receipt === 'string') receipt = data.receipt;
    } catch { /* Optional measurement cannot block the page or form. */ }
    finally {
      sending = false;
      if (sentConsent && !hasStatisticsConsent(doc, win)) post({ revoke: true }).catch(() => {});
      if (!sentConsent && hasStatisticsConsent(doc, win)) { receipt=''; attempts=0; }
      if (!receipt && attempts < 3) timer = win.setTimeout(record, Math.max(1,attempts) * 3000);
    }
  }
  // A redirect/prefetch alone is not counted. Require a visible rendered page.
  const schedule = () => { if (!doc.hidden) { win.clearTimeout(timer); timer = win.setTimeout(record, 1200); } };
  doc.addEventListener('visibilitychange', schedule);
  function consentChanged() {
    const current = hasStatisticsConsent(doc, win);
    if (current === consent) return;
    consent = current;
    if (!current) post({ revoke: true }).catch(() => {});
    else { receipt = ''; attempts = 0; schedule(); }
  }
  doc.addEventListener('click', event => {
    if (event.target?.closest?.('[data-dv-consent],#acceptAllCookies,#savePreferences,#declineNonEssential,#acceptAllInModal')) win.setTimeout(consentChanged, 0);
  });
  win.addEventListener('storage', consentChanged);
  win.addEventListener('focus', consentChanged);
  schedule();
}
