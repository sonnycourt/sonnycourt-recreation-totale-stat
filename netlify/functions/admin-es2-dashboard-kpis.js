import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function toBool(value) {
  return value === true;
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function computeKpis(rows) {
  const inscrits = rows.length;
  const presents = rows.filter((r) => toBool(r.attended_live)).length;
  const sawOffer = rows.filter((r) => toBool(r.saw_offer)).length;
  const clickedCta = rows.filter((r) => toBool(r.clicked_cta)).length;
  const watched30 = rows.filter((r) => toInt(r.watch_max_minutes) >= 30).length;
  const visitedSales = rows.filter((r) => toBool(r.visited_sales)).length;
  const watchedReplay = rows.filter((r) => toBool(r.watched_replay)).length;

  const presenceRate = inscrits > 0 ? (presents / inscrits) * 100 : 0;
  const ctaConversionRate = presents > 0 ? (clickedCta / presents) * 100 : 0;

  const funnel = [
    { id: 'inscrits', label: 'Inscrits', count: inscrits },
    { id: 'presents', label: 'Présents', count: presents },
    { id: 'watch30', label: 'Vu > 30 min', count: watched30 },
    { id: 'offer', label: 'Vu offre (CTA)', count: sawOffer },
    { id: 'clicked', label: 'Cliqué CTA', count: clickedCta },
    { id: 'sales', label: 'Page vente', count: visitedSales },
    { id: 'replay', label: 'Vu replay', count: watchedReplay },
  ].map((item) => ({
    ...item,
    percent: inscrits > 0 ? Math.max(0, Math.min(100, (item.count / inscrits) * 100)) : 0,
  }));

  return {
    cards: {
      inscrits,
      presents,
      presenceRate,
      sawOffer,
      clickedCta,
      ctaConversionRate,
    },
    funnel,
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  try {
    const url = new URL(req.url);
    const sessionDateFilter = String(url.searchParams.get('session_date') || '').trim(); // YYYY-MM-DD

    const res = await supabaseGet(
      'webinaire_registrations?select=token,email,prenom,session_date,statut,attended_live,watch_max_minutes,saw_offer,clicked_cta,visited_sales,watched_replay,created_at&order=session_date.desc&limit=10000',
    );
    if (!res.ok) {
      return jsonResponse(500, { error: 'Erreur lecture base' });
    }

    const allRows = Array.isArray(res.data) ? res.data : [];
    const sessionDates = Array.from(
      new Set(
        allRows
          .map((r) => String(r?.session_date || '').slice(0, 10))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      ),
    ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    const filteredRows = sessionDateFilter
      ? allRows.filter((r) => String(r?.session_date || '').slice(0, 10) === sessionDateFilter)
      : allRows;

    const kpis = computeKpis(filteredRows);

    return jsonResponse(200, {
      ok: true,
      filter: {
        session_date: sessionDateFilter || null,
      },
      sessions: sessionDates,
      totalRows: filteredRows.length,
      cards: kpis.cards,
      funnel: kpis.funnel,
    });
  } catch (error) {
    console.error('admin-es2-dashboard-kpis error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
