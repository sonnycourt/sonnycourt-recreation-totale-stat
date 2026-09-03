const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString('utf8').trim();
let input = {};
try { input = JSON.parse(stdin || '{}'); } catch { input = { MAILERLITE_API_KEY: stdin }; }
const apiKey = String(input.MAILERLITE_API_KEY || process.env.MAILERLITE_API_KEY || '').trim();
if (!apiKey) throw new Error('MAILERLITE_API_KEY manquante');
const wantedGroups = [
  ['MAILERLITE_GROUP_MC2_CONFIRMATION', 'MC2 — Inscription confirmée'],
  ['MAILERLITE_GROUP_MC2_SESSION_REMINDER_1H', 'MC2 — Rappel session — 1 heure'],
  ['MAILERLITE_GROUP_MC2_OFFER_FOLLOWUP_90M', 'MC2 — Offre — suivi 90 minutes'],
  ['MAILERLITE_GROUP_MC2_OFFER_CONSULTATIONS_12H', 'MC2 — Offre — consultations 12 heures'],
  ['MAILERLITE_GROUP_MC2_OFFER_PROOF_36H', 'MC2 — Offre — preuve 36 heures'],
  ['MAILERLITE_GROUP_MC2_OFFER_4H', 'MC2 — Offre — 4 heures restantes'],
  ['MAILERLITE_GROUP_MC2_OFFER_1H', 'MC2 — Offre — 1 heure restante'],
  ['MAILERLITE_GROUP_MC2_OFFER_5_PLACES', 'MC2 — Offre — 5 places restantes'],
];
const wantedFields = [
  ['mc2_confirmation_url', 'text'], ['mc2_session_url', 'text'], ['mc2_session_local_label', 'text'],
  ['mc2_offer_url', 'text'], ['mc2_offer_expires_at', 'text'],
];
async function api(path, options = {}) {
  const response = await fetch(`https://connect.mailerlite.com/api${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MailerLite ${response.status}: ${data.message || path}`);
  return data;
}
const groups = [];
let cursor = '';
do {
  const page = await api(`/groups?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  groups.push(...(page.data || []));
  cursor = page.links?.next ? new URL(page.links.next).searchParams.get('cursor') || '' : '';
} while (cursor);
for (const [envName, name] of wantedGroups) {
  let group = groups.find((item) => item.name === name);
  if (!group) group = (await api('/groups', { method: 'POST', body: JSON.stringify({ name }) })).data;
  if (!group?.id) throw new Error(`Groupe MailerLite introuvable: ${name}`);
  process.stdout.write(`${envName}=${group.id}\n`);
}
const fields = (await api('/fields?limit=100')).data || [];
for (const [name, type] of wantedFields) {
  if (!fields.some((item) => item.key === name || item.name === name)) {
    await api('/fields', { method: 'POST', body: JSON.stringify({ name, type }) });
  }
}
