import { getRegistrationSessionInstantUtc } from './lib/webinaire-session-paris.mjs';
import { getSupabaseConfig, supabaseHeaders } from './lib/supabase-rest.mjs';

const DISPLAY_THRESHOLD = 300;

function json(body, status = 200, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const session = getRegistrationSessionInstantUtc(new Date());
  const { url, key } = getSupabaseConfig();

  if (!session || !url || !key) {
    return json({ error: 'Configuration unavailable' }, 500);
  }

  const sessionDate = session.toISOString();
  const query = new URLSearchParams({
    select: 'token',
    session_date: `eq.${sessionDate}`,
    telephone: 'not.is.null',
    limit: '1',
  });

  try {
    const response = await fetch(
      `${url}/rest/v1/webinaire_registrations?${query.toString()}`,
      {
        headers: supabaseHeaders({
          Prefer: 'count=exact',
          Range: '0-0',
          'Range-Unit': 'items',
        }),
      },
    );

    if (!response.ok) {
      console.error('masterclass-session-count Supabase status:', response.status);
      return json({ error: 'Count unavailable' }, 502);
    }

    const contentRange = response.headers.get('content-range') || '';
    const match = contentRange.match(/\/(\d+)$/);
    if (!match) {
      console.error('masterclass-session-count invalid Content-Range:', contentRange);
      return json({ error: 'Count unavailable' }, 502);
    }

    const count = Number(match[1]);
    const cacheControl = 'public, max-age=60, s-maxage=120, stale-while-revalidate=300';

    if (count < DISPLAY_THRESHOLD) {
      return json({ visible: false, session_date: sessionDate }, 200, cacheControl);
    }

    return json(
      { visible: true, count, session_date: sessionDate },
      200,
      cacheControl,
    );
  } catch (error) {
    console.error('masterclass-session-count:', error);
    return json({ error: 'Count unavailable' }, 502);
  }
};
