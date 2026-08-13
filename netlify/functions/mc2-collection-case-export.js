import { getSessionFromRequest } from './lib/admin-es2-verify-cookie.mjs';
import { supabaseGet, supabasePost } from './lib/supabase-rest.mjs';
import {
  mc2CollectionCsvExport,
  mc2CollectionExportsEnabled,
  mc2CollectionJsonExport,
  stableStringify,
} from './lib/mc2-collection-case.mjs';
import crypto from 'node:crypto';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Méthode non autorisée' });
  if (!getSessionFromRequest(req)) return json(401, { error: 'Non autorisé' });
  if (!mc2CollectionExportsEnabled()) return json(423, { error: 'Exports verrouillés' });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id') || 0);
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  if (!Number.isSafeInteger(id) || id < 1) return json(400, { error: 'Dossier invalide' });
  const result = await supabaseGet(`mc2_collection_cases?id=eq.${id}&select=*&limit=1`);
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return json(404, { error: 'Dossier introuvable' });
  // Verrou absolu : même avec le flag d'export, aucune sortie avant décision
  // humaine explicite matérialisée par le statut approved.
  if (row.status !== 'approved' || !row.approved_at || !row.approved_by) {
    return json(409, { error: 'Validation humaine requise' });
  }
  const [revisionsResult, auditResult] = await Promise.all([
    supabaseGet(`mc2_collection_case_revisions?case_id=eq.${id}&select=revision,snapshot_sha256,completeness,created_at&order=revision.asc`),
    supabaseGet(`mc2_collection_case_audit?case_id=eq.${id}&select=event_type,actor_type,actor_id,payload,event_sha256,occurred_at&order=occurred_at.asc,id.asc`),
  ]);
  if (!revisionsResult.ok || !auditResult.ok) return json(500, { error: 'Historique immuable indisponible' });
  const content = format === 'csv'
    ? mc2CollectionCsvExport(row)
    : `${JSON.stringify(mc2CollectionJsonExport(row, {
      revisions: revisionsResult.data,
      audit: auditResult.data,
    }), null, 2)}\n`;
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  const auditPayload = { format, content_sha256: sha, revision: row.revision };
  const audit = await supabasePost('mc2_collection_case_audit', {
    case_id: row.id,
    event_type: 'export_downloaded',
    actor_type: 'export',
    actor_id: row.approved_by,
    payload: auditPayload,
    event_sha256: crypto.createHash('sha256').update(stableStringify({ case_id: row.id, ...auditPayload })).digest('hex'),
  });
  if (!audit.ok) return json(500, { error: 'Audit export impossible' });
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${row.case_number}.${format}"`,
      'Cache-Control': 'no-store',
      'X-Content-SHA256': sha,
    },
  });
};
