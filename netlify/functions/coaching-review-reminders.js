import { sendCoachingReviewRequestOnce } from './lib/coaching-integrations.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async () => {
  try {
    const now = Date.now();
    const endedBefore = encodeURIComponent(new Date(now - 30 * 60 * 1000).toISOString());
    const endedAfter = encodeURIComponent(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
    const sessionsResult = await supabaseGet(
      `coaching_sessions?status=in.(confirmed,completed)&ends_at=lte.${endedBefore}&ends_at=gte.${endedAfter}&select=id&order=ends_at.asc&limit=50`,
    );
    if (!sessionsResult.ok) throw new Error(`review_sessions_${sessionsResult.status}`);

    const sessions = Array.isArray(sessionsResult.data) ? sessionsResult.data : [];
    if (!sessions.length) return json(200, { ok: true, checked: 0, sent: 0 });

    const ids = sessions.map((session) => session.id).filter(Boolean);
    const reviewResult = await supabaseGet(
      `coaching_session_reviews?session_id=in.(${ids.map(encodeURIComponent).join(',')})&select=session_id`,
    );
    if (!reviewResult.ok) throw new Error(`review_lookup_${reviewResult.status}`);
    const reviewed = new Set((reviewResult.data || []).map((review) => review.session_id));

    let sent = 0;
    let alreadySent = 0;
    let failed = 0;
    for (const session of sessions) {
      if (reviewed.has(session.id)) continue;
      try {
        const result = await sendCoachingReviewRequestOnce(session.id);
        if (result.status === 'sent') sent += 1;
        else if (result.status === 'already_sent') alreadySent += 1;
      } catch (error) {
        failed += 1;
        console.error('coaching review reminder:', session.id, error);
      }
    }

    return json(failed ? 207 : 200, { ok: failed === 0, checked: sessions.length, sent, already_sent: alreadySent, failed });
  } catch (error) {
    console.error('coaching review reminders:', error);
    return json(500, { ok: false, error: error.message });
  }
};
