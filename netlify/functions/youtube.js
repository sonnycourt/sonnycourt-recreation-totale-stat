// Netlify Function: YouTube proxy (keeps API key server-side)
// Usage:
//  /.netlify/functions/youtube?action=search&maxResults=50
//  /.netlify/functions/youtube?action=videos&ids=ID1,ID2
// Optional: &channelId=... (defaults to env YOUTUBE_CHANNEL_ID)

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const action = params.action;

    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelId = params.channelId || process.env.YOUTUBE_CHANNEL_ID;
    const maxResults = params.maxResults || '50';

    if (!apiKey) {
      return json(500, { error: 'Missing YOUTUBE_API_KEY env var' });
    }

    if (action === 'search') {
      const url = new URL('https://www.googleapis.com/youtube/v3/search');
      url.searchParams.set('key', apiKey);
      if (channelId) url.searchParams.set('channelId', channelId);
      url.searchParams.set('part', 'snippet,id');
      url.searchParams.set('order', 'date');
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('type', 'video');

      const res = await fetch(url.toString());
      const data = await res.json();
      return json(res.status, data);
    }

    if (action === 'videos') {
      const ids = params.ids || '';
      if (!ids) {
        return json(400, { error: 'Missing ids parameter' });
      }
      const url = new URL('https://www.googleapis.com/youtube/v3/videos');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('id', ids);
      url.searchParams.set('part', 'contentDetails,snippet');

      const res = await fetch(url.toString());
      const data = await res.json();
      return json(res.status, data);
    }

    return json(400, { error: 'Unsupported action' });
  } catch (error) {
    return json(500, { error: error.message });
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}


