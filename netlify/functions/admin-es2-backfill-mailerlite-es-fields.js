/**
 * One-shot / admin : backfill MailerLite champs es_session_date, es_country, unique_token_webinaire
 * depuis webinaire_registrations (Supabase).
 *
 * Auth : cookie session admin ES2 (même que le dashboard).
 *
 * Usage (après déploiement) :
 *   POST /.netlify/functions/admin-es2-backfill-mailerlite-es-fields
 *   Headers: Cookie: <session admin>
 *   Body JSON : { "dry_run": false, "limit": 200, "offset": 0 }
 *
 * Répéter en augmentant offset jusqu'à ce que processed < limit.
 */

import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet } from './lib/supabase-rest.mjs';
import { patchMailerLiteWebinaireCoreFields } from './lib/mailerlite-webinaire.mjs';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const session = getSessionFromRequest(req);
  if (!session) return jsonResponse(401, { error: 'Unauthorized' });

  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: 'MAILERLITE_API_KEY manquant' });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const dryRun = Boolean(body?.dry_run);
  const limit = Math.min(Math.max(1, Number(body?.limit) || 200), 500);
  const offset = Math.max(0, Number(body?.offset) || 0);

  try {
    const res = await supabaseGet(
      `webinaire_registrations?select=email,token,pays,session_date&order=created_at.asc&limit=${limit}&offset=${offset}`,
    );
    if (!res.ok) {
      return jsonResponse(500, { error: 'Erreur lecture Supabase', details: res.error });
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    const results = [];

    for (const row of rows) {
      const email = String(row?.email || '')
        .trim()
        .toLowerCase();
      const token = String(row?.token || '').trim();
      const pays = row?.pays != null ? String(row.pays).trim() : '';
      const sessionDateIso = row?.session_date || null;

      if (!email || !token) {
        results.push({ email: email || '(vide)', ok: false, reason: 'missing_email_or_token' });
        console.log('[backfill-ml-es-fields] skip', { email, reason: 'missing_email_or_token' });
        continue;
      }

      if (dryRun) {
        results.push({ email, ok: true, reason: 'dry_run' });
        console.log('[backfill-ml-es-fields] dry_run', { email, token: token.slice(0, 8) + '…', pays, sessionDateIso });
        continue;
      }

      const out = await patchMailerLiteWebinaireCoreFields({
        email,
        token,
        pays,
        sessionDateIso,
        apiKey,
      });
      results.push({ email, ok: out.ok, reason: out.reason || null, status: out.status });
      console.log('[backfill-ml-es-fields]', { email, ok: out.ok, reason: out.reason || null });

      await new Promise((r) => setTimeout(r, 40));
    }

    const nextOffset = rows.length === limit ? offset + rows.length : null;

    return jsonResponse(200, {
      ok: true,
      dry_run: dryRun,
      limit,
      offset,
      processed: rows.length,
      next_offset: nextOffset,
      results,
    });
  } catch (e) {
    console.error('admin-es2-backfill-mailerlite-es-fields:', e);
    return jsonResponse(500, { error: e?.message || 'Internal server error' });
  }
};
