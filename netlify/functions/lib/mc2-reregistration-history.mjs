import { supabaseGet } from './supabase-rest.mjs';
import { mc2ReregistrationDecision } from './mc2-reregistration-policy.mjs';

// Lecture seule et pagination obligatoire : un historique incomplet ne doit
// pas transformer un ancien acheteur en prospect éligible.
async function readAll(read, query) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const result = await read(`${query}&limit=100&offset=${offset}`);
    if (!result.ok || !Array.isArray(result.data)) throw new Error('history_unavailable');
    rows.push(...result.data);
    if (result.data.length < 100) return rows;
    if (offset >= 9900) throw new Error('history_too_large');
  }
}

export async function inspectMc2Reregistration(email, { read = supabaseGet, now = Date.now() } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error('invalid_email');
  const filter = encodeURIComponent(normalized);
  const [current, legacy, exclusions] = await Promise.all([
    readAll(read, `mc2_registrations?email=eq.${filter}&select=*&order=id.asc`),
    readAll(read, `webinaire_registrations?email=eq.${filter}&select=token,statut,purchased,purchased_at,session_date,session_ends_at,saw_offer&order=token.asc`),
    readAll(read, `webinaire_exclusions?email=eq.${filter}&select=raison&order=email.asc`),
  ]);
  const archives = [];
  const evidence = [];
  for (const row of current) {
    const token = encodeURIComponent(row.token);
    archives.push(...await readAll(read, `mc2_registration_history?token=eq.${token}&select=snapshot&order=id.asc`));
    // Pas de filtre version courante : une preuve historique reste valide.
    evidence.push(...await readAll(read, `mc2_tracking_events_v2?token=eq.${token}&event_name=eq.cta_playback_present&select=event_name&order=event_id.asc`));
  }
  const registrations = [
    ...current,
    ...legacy.map(row => ({ ...row, session_starts_at: row.session_date })),
    ...archives.map(row => row.snapshot),
  ];
  // Les exclusions protégées (notamment acheteur) priment sur une raison
  // d'inscription si plusieurs lignes historiques existent.
  const decisions = (exclusions.length ? exclusions : [{ raison: null }]).map(row =>
    mc2ReregistrationDecision({ registrations, events: evidence, exclusionReason: row.raison, now }));
  const rank = { blocked: 0, retry: 1, review: 2, existing_session: 3, reregister: 4, register: 5 };
  decisions.sort((a, b) => rank[a.action] - rank[b.action]);
  return { decision: decisions[0], current: current[0] || null,
    legacyCount: legacy.length, archiveCount: archives.length,
    legacyOfferUnverified: legacy.some(row => row.saw_offer === true) };
}
