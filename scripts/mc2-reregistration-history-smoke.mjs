import assert from 'node:assert/strict';
import { inspectMc2Reregistration } from '../netlify/functions/lib/mc2-reregistration-history.mjs';
const now = Date.parse('2026-10-03T10:00:00Z');
const past = { id: 1, token: 'unit', statut: 'registered', session_ends_at: '2026-10-01T10:00:00Z' };
function reader(tables) {
  return async path => {
    const [table, query] = path.split('?');
    const params = new URLSearchParams(query);
    const rows = tables[table] || [];
    const offset = Number(params.get('offset') || 0);
    return { ok: true, data: rows.slice(offset, offset + Number(params.get('limit'))) };
  };
}
let result = await inspectMc2Reregistration('UNIT@example.invalid', { now, read: reader({ mc2_registrations: [past] }) });
assert.equal(result.decision.action, 'reregister');
result = await inspectMc2Reregistration('unit@example.invalid', { now, read: reader({
  mc2_registrations: [past], mc2_registration_history: [{ snapshot: { purchased_at: '2026-01-01' } }],
}) });
assert.equal(result.decision.reason, 'buyer');
result = await inspectMc2Reregistration('unit@example.invalid', { now, read: reader({
  webinaire_registrations: [...Array.from({ length: 100 }, (_, id) => ({ ...past, token: `old-${id}` })), { purchased: true }],
}) });
assert.equal(result.decision.reason, 'buyer');
assert.equal(result.legacyCount, 101);
result = await inspectMc2Reregistration('unit@example.invalid', { now, read: reader({
  mc2_registrations: [past], mc2_tracking_events_v2: [{ event_name: 'cta_playback_present' }],
}) });
assert.equal(result.decision.reason, 'cta_playback');
result = await inspectMc2Reregistration('unit@example.invalid', { now, read: reader({
  mc2_registrations: [past], webinaire_exclusions: [{ raison: 'inscrit_mc2' }, { raison: 'acheteur_es' }],
}) });
assert.equal(result.decision.reason, 'protected_exclusion');
await assert.rejects(inspectMc2Reregistration('unit@example.invalid', { read: async () => ({ ok: false }) }));
console.log('Historique : acheteurs legacy/archivés, CTA, pagination, exclusions et panne DB OK ; aucun appel réseau.');
