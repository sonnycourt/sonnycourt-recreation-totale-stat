const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
const apiKey = String(input.MAILERLITE_API_KEY || process.env.MAILERLITE_API_KEY || '').trim();
if (!apiKey) throw new Error('MAILERLITE_API_KEY manquante');

const wantedGroups = [
  ['MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW', 'MC2 — Replay — no-show'],
  ['MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA', 'MC2 — Replay — parti avant offre'],
  ['MAILERLITE_GROUP_MC2_OFFER_SEEN', 'MC2 — Offre vue — sans achat'],
];
const wantedFields = [
  ['mc2_recovery_segment', 'text'],
  ['mc2_replay_url', 'text'],
  ['mc2_replay_expires_at', 'text'],
  ['mc2_offer_url', 'text'],
  ['mc2_replay_resume_seconds', 'number'],
];

async function api(path, options = {}) {
  const response = await fetch(`https://connect.mailerlite.com/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MailerLite ${response.status}: ${data.message || path}`);
  return data;
}
const groups = (await api('/groups?limit=100')).data || [];
for (const [envName, name] of wantedGroups) {
  let group = groups.find((item) => item.name === name);
  if (!group) group = (await api('/groups', { method: 'POST', body: JSON.stringify({ name }) })).data;
  process.stdout.write(`${envName}=${group.id}\n`);
}

const fields = (await api('/fields?limit=100')).data || [];
for (const [name, type] of wantedFields) {
  if (fields.some((item) => item.key === name || item.name === name)) continue;
  await api('/fields', { method: 'POST', body: JSON.stringify({ name, type }) });
}
