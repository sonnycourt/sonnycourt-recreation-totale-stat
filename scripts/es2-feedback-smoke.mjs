// All database and notification calls are intercepted. Never contacts real services.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import submit from '../netlify/functions/submit-es2-feedback.js';
import access from '../netlify/functions/get-es2-feedback-access.js';
import { FEEDBACK_GROUPS as groups, FEEDBACK_TEXT_FIELDS, normalizeFeedbackAnswers, feedbackV2Record, feedbackV2Notification, telegramFeedbackParts } from '../src/lib/es2-feedback.mjs';

process.env.SUPABASE_URL = 'https://feedback-db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.TELEGRAM_BOT_TOKEN = 'test-only';
process.env.TELEGRAM_CHAT_ID = 'test-only-chat';
process.env.MAILERLITE_API_KEY = 'test-only';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fixture;
function reset() {
  fixture = { records: [], messages: [], documents: [], emails: [], events: [], buyer: true, missing: false, readFail: false, insertFail: false, telegramFail: false, missingColumn: false, release: null };
}
reset();
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === 'feedback-db.test') {
    if (options.method === 'POST') {
      assert.equal(u.pathname, '/rest/v1/es2_feedback');
      fixture.events.push('insert');
      if (fixture.insertFail) return json({ error: 'fixture insert error' }, 500);
      fixture.records.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    assert.equal(options.method, undefined);
    assert.equal(u.pathname, '/rest/v1/webinaire_registrations');
    fixture.events.push('read');
    if (fixture.readFail) return json({}, 500);
    if (fixture.missingColumn && u.searchParams.get('select').includes('es_purchased')) return json({}, 400);
    return json(fixture.missing ? [] : [{ token: 'fixture-token', email: 'student@example.invalid', prenom: 'Camille', purchased: fixture.buyer, ...(fixture.missingColumn ? {} : { es_purchased: fixture.buyer }) }]);
  }
  if (u.hostname === 'api.telegram.org') {
    assert.equal(options.method, 'POST');
    fixture.events.push('telegram');
    if (u.pathname.endsWith('/sendDocument')) fixture.documents.push(await options.body.get('document').text());
    else fixture.messages.push(JSON.parse(options.body));
    if (fixture.release) await fixture.release;
    return json({ ok: !fixture.telegramFail }, fixture.telegramFail ? 503 : 200);
  }
  if (u.hostname === 'connect.mailerlite.com') {
    fixture.events.push('email'); fixture.emails.push(JSON.parse(options.body)); return json({ ok: true });
  }
  throw new Error('Unexpected network destination: ' + u.hostname);
};
const raw = {
  feelings: [groups.feelings.values[0], groups.feelings.values[2]], priority: groups.priority.values[0],
  evolution: groups.evolution.values[1], gains: [groups.gains.values[0]], practice: groups.practice.values[2],
  barrier: [groups.barrier.values[0]], help: groups.help.values[0],
  ...Object.fromEntries(FEEDBACK_TEXT_FIELDS.map(key => [key, 'fixture-' + key + ' < & 🦋'])),
};
const post = body => submit(new Request('https://site.test/.netlify/functions/submit-es2-feedback', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
const payload = { token: 'fixture-token', form_version: 2, answers: raw, email: 'spoof@example.invalid', prenom: 'Spoof' };
let result = await post(payload);
assert.equal(result.status, 200); assert.equal((await result.json()).success, true);
assert.equal(fixture.records.length, 1); assert.equal(fixture.messages.length, 1); assert.equal(fixture.emails.length, 0);
assert.equal(fixture.records[0].email, 'student@example.invalid'); assert.equal(fixture.records[0].prenom, 'Camille');
assert.equal(fixture.records[0].score, null); assert.equal(fixture.records[0].module_reached, null);
assert.deepEqual(fixture.events, ['read', 'insert', 'telegram']);
const normalized = normalizeFeedbackAnswers(raw);
const stored = JSON.stringify(fixture.records[0]);
for (const value of Object.values(normalized).flat().filter(Boolean)) assert(stored.includes(value), 'Lost stored answer: ' + value);
const sentText = fixture.messages[0].text;
assert.equal(sentText, '📩 ' + feedbackV2Notification(normalized, fixture.records[0]).subject + '\n\n' + feedbackV2Notification(normalized, fixture.records[0]).body);
assert.equal(fixture.messages[0].parse_mode, undefined);
assert(!stored.includes('fixture-harder')); assert(!stored.includes('fixture-desiredChange'));

// Each conditional branch, including no improvement and uncertainty, remains valid.
for (const evolution of groups.evolution.values) {
  const answers = normalizeFeedbackAnswers({ ...raw, evolution });
  const record = feedbackV2Record(answers);
  assert(record.what_changed.includes(evolution));
  assert.equal(record.score, null);
  const notice = feedbackV2Notification(answers, { prenom: 'Test', email: 'test@example.invalid' });
  assert(notice.body.includes(evolution));
  if (evolution === groups.evolution.values[3]) { assert(notice.body.includes(raw.harder)); assert(!notice.body.includes(raw.progressExample)); }
}

// New validation rejects empty fields and forged choices before any database call.
for (const altered of [{ ...payload, token: '' }, { ...payload, form_version: 99 }, { ...payload, answers: null },
  { ...payload, answers: { ...raw, feelings: [] } }, { ...payload, answers: { ...raw, priority: 'forged' } },
  { ...payload, answers: { ...raw, feelings: groups.feelings.values.slice(0, 4) } },
  { ...payload, answers: { ...raw, scene: '   ' } }, { ...payload, answers: { ...raw, question: {} } },
  { ...payload, answers: { ...raw, barrier: [groups.barrier.values[0], 'Pas de frein particulier'] } }]) {
  reset(); assert.equal((await post(altered)).status, 400); assert.equal(fixture.events.length, 0);
}

// Access rules, compatibility with the missing es_purchased column, and failure handling.
for (const [flag, status] of [['missing', 404], ['readFail', 500], ['insertFail', 500]]) {
  reset(); fixture[flag] = true; assert.equal((await post(payload)).status, status); assert.equal(fixture.messages.length, 0);
}
reset(); fixture.buyer = false; assert.equal((await post(payload)).status, 403); assert.equal(fixture.records.length, 0);
reset(); fixture.missingColumn = true; assert.equal((await post(payload)).status, 200);
for (const path of ['?t=fixture-token', '?token=fixture-token', '?email=student%40example.invalid']) {
  reset(); const res = await access(new Request('https://site.test/access' + path)); assert.equal(res.status, 200); assert.equal((await res.json()).allowed, true);
}
reset(); fixture.buyer = false; assert.equal((await access(new Request('https://site.test/access?t=fixture-token'))).status, 403);

// Old forms already open in a browser are still accepted without fabricating v2 answers.
reset(); const legacy = { token: 'fixture-token', module_reached: 'Module 2', daily_practice: 'Tous les jours', what_changed: 'Calme', biggest_win: 'Déclic', what_blocks: 'Doute', help_needed: 'Pratique', score: 7 };
assert.equal((await post(legacy)).status, 200); assert.equal(fixture.records[0].score, 7); assert.equal(fixture.records[0].module_reached, 'Module 2');
assert(fixture.messages[0].text.includes('Bilan J+30')); assert(fixture.messages[0].text.includes('Score : 7/10'));
reset(); assert.equal((await post({ ...legacy, score: 11 })).status, 400); assert.equal(fixture.events.length, 0);

// Full long answers survive persistence and Telegram, with no HTML/entity truncation.
reset(); const long = normalizeFeedbackAnswers({ ...raw, scene: 'Long récit <&> 🦋\n'.repeat(900) + 'FIN DU RÉCIT' });
assert.equal((await post({ ...payload, answers: long })).status, 200);
const notification = feedbackV2Notification(long, fixture.records[0]);
assert(fixture.messages.length > 1);
assert.deepEqual(fixture.messages.map(m => m.text.replace(/^\[\d+\/\d+\]\n/, '')), telegramFeedbackParts(notification));
assert.equal(telegramFeedbackParts(notification).join(''), '📩 ' + notification.subject + '\n\n' + notification.body);
assert(fixture.messages.every(m => Array.from(m.text).length <= 4096));
assert(fixture.records[0].what_blocks.includes('FIN DU RÉCIT'));
reset(); const veryLong = normalizeFeedbackAnswers({ ...raw, scene: 'Un récit très détaillé 🦋\n'.repeat(2000) + 'FIN INTÉGRALE' });
assert.equal((await post({ ...payload, answers: veryLong })).status, 200);
assert.equal(fixture.messages.length, 0); assert.equal(fixture.documents.length, 1);
assert.equal(fixture.documents[0], feedbackV2Notification(veryLong, fixture.records[0]).subject + '\n\n' + feedbackV2Notification(veryLong, fixture.records[0]).body);

// Notification remains awaited; email fallback preserves the complete new report.
reset(); fixture.telegramFail = true; assert.equal((await post(payload)).status, 200); assert.equal(fixture.emails.length, 1); assert(fixture.emails[0].text.includes(raw.question));
reset(); let release; fixture.release = new Promise(resolve => { release = resolve; }); let finished = false;
const pending = post(payload).then(res => { finished = true; return res; });
await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(finished, false); assert.equal(fixture.records.length, 1); release(); await pending; assert.equal(finished, true);
assert.equal((await submit(new Request('https://site.test/api', { method: 'OPTIONS' }))).status, 200);
assert.equal((await submit(new Request('https://site.test/api'))).status, 405);

// Static contract guard: the client uses the same endpoint and cannot send in preview.
const client = readFileSync(new URL('../src/lib/es2-feedback-client.mjs', import.meta.url), 'utf8');
assert(client.includes('/.netlify/functions/get-es2-feedback-access?'));
assert(client.includes('/.netlify/functions/submit-es2-feedback'));
assert(client.indexOf("if (preview) { success(") < client.indexOf("fetch('/.netlify/functions/submit-es2-feedback'"));
const page = readFileSync(new URL('../src/pages/es2/feedback.astro', import.meta.url), 'utf8');
assert(!page.includes('Ton bilan à 30 jours')); assert(page.includes('Ces derniers jours/semaines'));
const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
console.log('PASS: v2 and legacy submission; identity/access; all evolution branches; complete storage; long Unicode notifications; awaited Telegram; email fallback; preview isolation. No real network calls.');
