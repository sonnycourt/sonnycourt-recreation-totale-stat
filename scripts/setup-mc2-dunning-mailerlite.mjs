const raw = [];
for await (const chunk of process.stdin) raw.push(chunk);
const input = JSON.parse(Buffer.concat(raw).toString('utf8') || '{}');
const apiKey = String(input.MAILERLITE_API_KEY || process.env.MAILERLITE_API_KEY || '').trim();
if (!apiKey) throw new Error('MAILERLITE_API_KEY manquante');

const wanted = [
  ['MAILERLITE_GROUP_MC2_PAYMENT_FAILED_1', 'MC2 — Paiement échoué 1 — premier échec'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_FAILED_2', 'MC2 — Paiement échoué 2 — relance 1'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_FAILED_3', 'MC2 — Paiement échoué 3 — relance 2'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_FAILED_4', 'MC2 — Paiement échoué 4 — relance 3'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_FAILED_5', 'MC2 — Paiement échoué 5 — relance 4'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_FAILED_6', 'MC2 — Paiement échoué 6 — dernière relance'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_ACTION_REQUIRED', 'MC2 — Authentification bancaire requise'],
  ['MAILERLITE_GROUP_MC2_PAYMENT_FINAL_FAILED', 'MC2 — Paiement définitivement échoué'],
];

async function mailerLite(path, options = {}) {
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

const existing = [];
let cursor = '';
do {
  const suffix = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
  const page = await mailerLite(`/groups${suffix}`);
  existing.push(...(page.data || []));
  const next = page.links?.next || '';
  cursor = next ? new URL(next).searchParams.get('cursor') || '' : '';
} while (cursor);

for (const [envName, groupName] of wanted) {
  let group = existing.find((item) => item.name === groupName);
  if (!group) {
    const created = await mailerLite('/groups', {
      method: 'POST',
      body: JSON.stringify({ name: groupName }),
    });
    group = created.data;
  }
  if (!group?.id) throw new Error(`Groupe MailerLite introuvable: ${groupName}`);
  process.stdout.write(`${envName}=${group.id}\n`);
}
