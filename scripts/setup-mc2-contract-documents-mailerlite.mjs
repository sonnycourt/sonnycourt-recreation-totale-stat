const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString('utf8').trim();
let input = {};
try { input = JSON.parse(stdin || '{}'); } catch { input = { MAILERLITE_API_KEY: stdin }; }
const apiKey = String(input.MAILERLITE_API_KEY || process.env.MAILERLITE_API_KEY || '').trim();
if (!apiKey) throw new Error('MAILERLITE_API_KEY manquante');

const groupName = 'MC2 — Documents contractuels';
const wantedFields = [
  ['mc2_contract_documents_url', 'text'],
  ['mc2_contract_purchase_date', 'text'],
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

const groups = [];
let cursor = '';
do {
  const page = await api(`/groups?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  groups.push(...(page.data || []));
  cursor = page.links?.next ? new URL(page.links.next).searchParams.get('cursor') || '' : '';
} while (cursor);
let group = groups.find((item) => item.name === groupName);
if (!group) group = (await api('/groups', { method: 'POST', body: JSON.stringify({ name: groupName }) })).data;
if (!group?.id) throw new Error(`Groupe MailerLite introuvable: ${groupName}`);

const fields = (await api('/fields?limit=100')).data || [];
for (const [name, type] of wantedFields) {
  if (!fields.some((item) => item.key === name || item.name === name)) {
    await api('/fields', { method: 'POST', body: JSON.stringify({ name, type }) });
  }
}
process.stdout.write(`MAILERLITE_GROUP_MC2_CONTRACT_DOCUMENTS=${group.id}\n`);

