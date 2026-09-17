// Domaine pur : utilisé côté serveur et testé sans réseau ni base de production.
export const FILTERS = ['all', 'new', 'due', 'booked', 'done', 'paused'];
export const KINDS = ['updated', 'call_no_answer', 'sms_sent', 'whatsapp_sent', 'contacted', 'completed', 'note'];
export const STATUSES = ['new', 'contacting', 'awaiting', 'contacted', 'booked', 'done', 'paused'];
export const ACTIONS = ['call', 'sms', 'whatsapp', 'followup', 'onboarding', 'none'];
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

export function validateCommand(body) {
  if (!body || !isUuid(body.case_id) || !isUuid(body.command_id) || !Number.isSafeInteger(body.version) || body.version < 1
    || !KINDS.includes(body.kind) || typeof body.note !== 'string' || body.note.length > 4000
    || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) return false;
  for (const [key, value] of Object.entries(body.patch)) {
    if (['goal', 'motivations', 'obstacles', 'routine', 'notes'].includes(key)) {
      if (typeof value !== 'string' || value.length > (key === 'notes' ? 12000 : 4000)) return false;
    } else if (['training_access', 'community_access', 'feedback_explained'].includes(key)) {
      if (typeof value !== 'boolean') return false;
    } else if (['followup_at', 'onboarding_at', 'coaching_at'].includes(key)) {
      if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value)))) return false;
    } else if (key === 'status') {
      if (!STATUSES.includes(value)) return false;
    } else if (key === 'next_action') {
      if (!ACTIONS.includes(value)) return false;
    } else return false;
  }
  return true;
}

// Jour civil Paris, pas +N×24h en UTC : reste juste lors du changement d'heure.
export function parisDay(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  return ['year', 'month', 'day'].map((type) => parts.find((p) => p.type === type).value).join('-');
}
export function plusDays(iso, count) {
  const date = new Date(`${parisDay(iso)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function presentCase(row) {
  return {
    ...row,
    name: row.preferred_name || row.display_name,
    country: row.country_override || row.country,
    first_payment_date: row.payment_date_override || (row.source === 'mc2' ? plusDays(row.purchased_at, 7) : null),
    payment_date_source: row.payment_date_source || 'Échéance théorique J+7 — ne confirme pas un encaissement',
    coaching_from: plusDays(row.purchased_at, 33),
    feedback_date: plusDays(row.purchased_at, 14),
    plan_label: row.plan === 'six' ? '6 mensualités de 347 € · démarrage à 0 €' : row.plan === 'legacy_three'
      ? 'Ancien modèle · 3 versements de 767 €' : '12 mensualités de 197 € · démarrage à 0 €',
  };
}
