// Local integration fixture ONLY. No credentials, real DB writes or notifications.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import submit from '../netlify/functions/submit-es2-feedback.js';
import access from '../netlify/functions/get-es2-feedback-access.js';

process.env.SUPABASE_URL = 'https://es2-fixture.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
process.env.TELEGRAM_BOT_TOKEN = 'fixture-only';
process.env.TELEGRAM_CHAT_ID = 'fixture-only';
process.env.MAILERLITE_API_KEY = '';
const records = [], messages = [];
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url);
  if (target.hostname === 'es2-fixture.invalid') {
    if (target.pathname === '/rest/v1/es2_feedback' && options.method === 'POST') {
      records.push(JSON.parse(options.body)); return new Response(null, { status: 201 });
    }
    if (target.pathname === '/rest/v1/webinaire_registrations' && !options.method) {
      const match = target.searchParams.get('token') === 'eq.fixture-token' || target.searchParams.get('email') === 'eq.student@example.invalid';
      return json(match ? [{ token: 'fixture-token', email: 'student@example.invalid', prenom: 'Camille (test)', purchased: true, es_purchased: true }] : []);
    }
  }
  if (target.hostname === 'api.telegram.org' && target.pathname === '/botfixture-only/sendMessage') {
    messages.push(JSON.parse(options.body)); return json({ ok: true });
  }
  throw new Error('Network blocked by local test fixture');
};
const dist = resolve(new URL('../dist', import.meta.url).pathname);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4404');
    if (url.pathname === '/__fixture-state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ records: records.length, notifications: messages.length, stored: records.at(-1), notified: messages.map(m => m.text).join('') })); return;
    }
    if (url.pathname.startsWith('/.netlify/functions/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const response = url.pathname.endsWith('/get-es2-feedback-access') ? await access(request) : url.pathname.endsWith('/submit-es2-feedback') ? await submit(request) : json({}, 404);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(dist, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(dist + '/')) { res.writeHead(403); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(500); res.end('Local fixture error'); }
});
server.listen(4404, '127.0.0.1', () => console.log('Fixture only: http://127.0.0.1:4404/es2/feedback/ — student@example.invalid'));
