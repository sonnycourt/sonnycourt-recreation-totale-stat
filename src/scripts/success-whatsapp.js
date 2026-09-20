// Optional measurement: never intercept WhatsApp, video, or community access.
export function initSuccessWhatsApp() {
  const button = document.getElementById('coach-whatsapp');
  const qr = document.getElementById('coach-whatsapp-qr');
  if (!button || !qr) return;
  const params = new URLSearchParams(location.search);
  if (params.has('preview') || params.has('demo')) return;
  let token = new URLSearchParams(location.hash.slice(1)).get('mc2_whatsapp') || params.get('t') || params.get('mc2_token') || '';
  try {
    if (token) sessionStorage.setItem('mc2_success_token', token);
    else token = sessionStorage.getItem('mc2_success_token') || localStorage.getItem('mc2_registration_token') || '';
  } catch { /* Storage can be disabled. */ }
  if (!/^[a-zA-Z0-9_-]{20,100}$/.test(token)) return;
  const send = (action) => fetch('/.netlify/functions/mc2-whatsapp', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action }), keepalive: true,
  });
  button.addEventListener('click', () => { send('button_clicked').catch(() => {}); });
  button.addEventListener('auxclick', (event) => { if (event.button === 1) send('button_clicked').catch(() => {}); });
  send('prepare').then((response) => response.ok ? response.json() : null).then((data) => {
    if (!data?.qr?.startsWith('data:image/svg+xml;base64,')) return;
    const image = new Image();
    image.onload = () => { qr.src = data.qr; };
    image.src = data.qr;
  }).catch(() => {});
}
