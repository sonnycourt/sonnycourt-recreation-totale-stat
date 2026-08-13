import crypto from 'node:crypto';
import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';
import { mc2CollectionEnabled, stableStringify } from './lib/mc2-collection-case.mjs';

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function sameOrigin(req) {
  const origin = clean(req.headers.get('origin'), 300);
  if (!origin) return false;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

export default async (req) => {
  const session = getSessionFromRequest(req);
  if (!session) return json(401, { error: 'Non autorisé' });
  if (!mc2CollectionEnabled()) return json(423, { error: 'Préparation des dossiers verrouillée' });
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  if (!sameOrigin(req)) return json(403, { error: 'Origine non autorisée' });
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id || 0);
  const action = clean(body.action, 30);
  const confirmation = clean(body.confirmation, 120);
  if (!Number.isSafeInteger(id) || id < 1 || !['approve', 'reject'].includes(action)) {
    return json(400, { error: 'Décision invalide' });
  }
  const result = await supabaseGet(`mc2_collection_cases?id=eq.${id}&select=*&limit=1`);
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return json(404, { error: 'Dossier introuvable' });
  const expected = action === 'approve'
    ? `APPROUVER ${row.case_number}`
    : `REJETER ${row.case_number}`;
  if (confirmation !== expected) return json(400, { error: 'Confirmation exacte requise', expected });
  if (action === 'approve') {
    if (row.status !== 'ready_for_review' || row.completeness?.complete !== true) {
      return json(409, { error: 'Dossier incomplet ou non prêt' });
    }
  } else if (!['ready_for_review', 'needs_information'].includes(row.status)) {
    return json(409, { error: 'Dossier déjà traité' });
  }
  const actor = 'pay-admin';
  const reason = action === 'reject' ? clean(body.reason, 1_000) || 'Rejet manuel' : null;
  const auditPayload = { action, from_status: row.status, revision: row.revision, reason };
  const eventSha = crypto.createHash('sha256')
    .update(stableStringify({ case_id: id, ...auditPayload }))
    .digest('hex');
  const reviewed = await supabasePost('rpc/review_mc2_collection_case', {
    p_case_id: id,
    p_action: action,
    p_expected_status: row.status,
    p_actor_id: actor,
    p_reason: reason,
    p_event_sha256: eventSha,
  });
  if (!reviewed.ok) return json(409, { error: 'Décision non enregistrée', detail: reviewed.error });
  const updated = Array.isArray(reviewed.data) ? reviewed.data[0] : reviewed.data;
  return json(200, { ok: true, status: updated?.status, case_number: row.case_number });
};
