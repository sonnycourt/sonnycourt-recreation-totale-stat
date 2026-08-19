const API_BASE = 'https://connect.mailerlite.com/api';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}

function clean(value, max) {
  return String(value || '').trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

async function mailerLite(path, apiKey, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function upsertWaitlistSubscriber({ email, prenom, apiKey, groupId }) {
  const existing = await mailerLite(`/subscribers/${encodeURIComponent(email)}`, apiKey);
  let subscriberId = existing.response.ok ? existing.payload?.data?.id : null;

  const subscriberBody = {
    email,
    status: 'active',
    resubscribe: true,
    fields: { first_name: prenom, name: prenom },
  };

  if (subscriberId) {
    const updated = await mailerLite(`/subscribers/${encodeURIComponent(subscriberId)}`, apiKey, {
      method: 'PUT',
      body: JSON.stringify(subscriberBody),
    });
    if (!updated.response.ok) throw new Error(`mailerlite_update_${updated.response.status}`);
  } else {
    const created = await mailerLite('/subscribers', apiKey, {
      method: 'POST',
      body: JSON.stringify(subscriberBody),
    });
    if (!created.response.ok) throw new Error(`mailerlite_create_${created.response.status}`);
    subscriberId = created.payload?.data?.id;
  }

  if (!subscriberId) throw new Error('mailerlite_subscriber_id_missing');

  const grouped = await mailerLite(
    `/subscribers/${encodeURIComponent(subscriberId)}/groups/${encodeURIComponent(groupId)}`,
    apiKey,
    { method: 'POST' },
  );
  if (!grouped.response.ok && grouped.response.status !== 422) {
    throw new Error(`mailerlite_group_${grouped.response.status}`);
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(200, { success: true });
  if (req.method !== 'POST') return json(405, { success: false, error: 'method_not_allowed' });

  const apiKey = clean(process.env.MAILERLITE_API_KEY, 500);
  const groupId = clean(process.env.MAILERLITE_GROUP_MC2_WAITLIST, 160);
  if (!apiKey || !groupId) {
    console.error('Masterclass waitlist MailerLite configuration missing');
    return json(503, { success: false, error: 'temporarily_unavailable' });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prenom = clean(body?.prenom, 120);
    const email = clean(body?.email, 320).toLowerCase();
    const company = clean(body?.company, 160);

    // Les robots remplissent souvent ce champ invisible. Réponse neutre, aucun appel externe.
    if (company) return json(200, { success: true });
    if (!prenom || !validEmail(email)) return json(400, { success: false, error: 'invalid_input' });

    await upsertWaitlistSubscriber({ email, prenom, apiKey, groupId });
    return json(200, { success: true });
  } catch (error) {
    console.error('Masterclass waitlist subscription failed:', error?.message || error);
    return json(502, { success: false, error: 'subscription_failed' });
  }
};

export { upsertWaitlistSubscriber };
