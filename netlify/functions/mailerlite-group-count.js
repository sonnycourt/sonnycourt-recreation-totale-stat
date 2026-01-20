// Netlify Function: return MailerLite group member count (active)
// GET /api/mailerlite-group-count

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_COURTCIRCUIT_2;

  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing MAILERLITE_API_KEY' }),
    };
  }

  if (!groupId) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Missing MAILERLITE_GROUP_COURTCIRCUIT_2' }),
    };
  }

  try {
    const res = await fetch(`https://connect.mailerlite.com/api/groups/${encodeURIComponent(groupId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({
          error: 'MailerLite request failed',
          status: res.status,
          details: text.substring(0, 500),
        }),
      };
    }

    const json = JSON.parse(text || '{}');
    const data = json?.data || {};

    const activeCount = Number(data.active_count);
    const unsubscribedCount = Number(data.unsubscribed_count);
    const unconfirmedCount = Number(data.unconfirmed_count);
    const bouncedCount = Number(data.bounced_count);
    const junkCount = Number(data.junk_count);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        groupId,
        name: data.name || null,
        activeCount: Number.isFinite(activeCount) ? activeCount : null,
        counts: {
          active: Number.isFinite(activeCount) ? activeCount : null,
          unsubscribed: Number.isFinite(unsubscribedCount) ? unsubscribedCount : null,
          unconfirmed: Number.isFinite(unconfirmedCount) ? unconfirmedCount : null,
          bounced: Number.isFinite(bouncedCount) ? bouncedCount : null,
          junk: Number.isFinite(junkCount) ? junkCount : null,
        },
        fetchedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch MailerLite group',
        details: error?.message || String(error),
      }),
    };
  }
};

