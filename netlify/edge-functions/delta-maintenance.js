// Temporary maintenance. Remove this function to reopen after test prices are restored.
const PASSWORD_HASH = '9ebf54dd2634a2f89a2ba753418df04b20b8500d51d3ea3aad16f8d4481b5388';
const ACCESS = '01d56176209020c98e4e1c81609d3c60c0b4670969c5f596af677cbad56b983f';
const DEADLINE = 1792584751930;
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };
export const config = { path: ['/delta-vision', '/delta-vision/', '/delta-vision/index.html'] };
export default async function(request, context) {
  const cookie = request.headers.get('cookie') || '';
  if (cookie.split(';').some(v => v.trim() === 'dv_maintenance_access=' + ACCESS)) {
    const response = await context.next();
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Netlify-CDN-Cache-Control', 'no-store');
    return response;
  }
  let error = '';
  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && origin !== 'null' && origin !== new URL(request.url).origin) return new Response('Accès refusé', { status: 403, headers });
    const body = await request.text();
    if (body.length > 1024) return new Response('Requête invalide', { status: 400, headers });
    const password = new URLSearchParams(body).get('password') || '';
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)))).map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash === PASSWORD_HASH) return new Response(null, { status: 303, headers: { ...headers, Location: request.url, 'Set-Cookie': 'dv_maintenance_access=' + ACCESS + '; Path=/; Max-Age=14400; Secure; HttpOnly; SameSite=Lax' } });
    error = 'Mot de passe incorrect.';
  }
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delta Vision — Maintenance</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:#102c24;color:#f8f1e5;font-family:system-ui,sans-serif;padding:24px}main{max-width:580px;text-align:center;padding:48px 28px;border:1px solid #bca87e55;border-radius:28px;background:radial-gradient(ellipse at top,#254c3d,#102c24)}small{letter-spacing:.3em;color:#d8be8b}h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(32px,6vw,48px);line-height:1.13}p{color:#dfdfd1;line-height:1.6}output{display:block;font-size:52px;font-variant-numeric:tabular-nums;color:#e7c68b;margin:24px}form{margin-top:32px}label{display:block;font-size:13px;margin-bottom:12px;color:#d9ccae}input,button{font:inherit;border-radius:10px;padding:14px;border:1px solid #bca87e66}input{background:#ffffff0b;color:white;max-width:100%;width:240px}button{background:#d4b582;color:#142d24;cursor:pointer;font-weight:600;margin:8px} .error{color:#ffb8a8;font-size:14px}</style></head><body><main><small>DELTA VISION</small><h1>Delta Vision revient<br>dans quelques minutes.</h1><p>Nous effectuons une courte maintenance<br>pour améliorer ton expérience.</p><p id="notice">Réouverture prévue dans environ 30 minutes.</p><output id="timer">30:00</output><form method="post"><label for="password">Accès privé</label><input id="password" name="password" type="password" placeholder="Mot de passe" autocomplete="current-password" required maxlength="128"><button type="submit">Entrer</button><p class="error" role="status">${error}</p></form></main><script>const deadline=${DEADLINE};function tick(){const s=Math.max(0,Math.ceil((deadline-Date.now())/1000));document.getElementById('timer').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');if(!s)document.getElementById('notice').textContent='Nous finalisons les derniers réglages. Merci pour ta patience.'}tick();setInterval(tick,1000);</script></body></html>`, { status: 503, headers: { ...headers, 'Retry-After': '1800' } });
}
