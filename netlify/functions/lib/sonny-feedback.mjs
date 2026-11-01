// Shared pure formatting and validation. No notification, payment or access changes.
export const normalizeEmail = value => String(value || '').trim().toLowerCase();
export const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>"(),]+@[^\s@<>"(),]+\.[^\s@<>"(),]+$/.test(value);
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const sourceId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && /^\d+$/.test(String(value));
export const REPLY_FIELDS = 'id,feedback_id,email,prenom,question,answer,answered_on,version,created_at,updated_at';
export const SOURCE_FIELDS = 'id,email,prenom,module_reached,daily_practice,what_changed,biggest_win,what_blocks,help_needed,score,created_at';
export function questionText(row) {
  return [
    ['Module atteint', row.module_reached], ['Pratique', row.daily_practice],
    ['Évolution', row.what_changed], ['Plus grand déclic / exemple', row.biggest_win],
    ['Situation et freins', row.what_blocks], ['Aide et question', row.help_needed],
    ['Score', row.score == null ? null : `${row.score}/10`],
  ].filter(([,v]) => v != null && v !== '').map(([k,v]) => `${k}\n${v}`).join('\n\n');
}
export function validReply(body, now = Date.now()) {
  if (!body || !uuid(body.id) || !uuid(body.command_id) || !Number.isSafeInteger(body.version) || body.version < 0) return false;
  if (body.feedback_id != null && !sourceId(body.feedback_id)) return false;
  if (!validEmail(body.email) || body.email !== normalizeEmail(body.email)) return false;
  if (typeof body.prenom !== 'string' || body.prenom.length > 150) return false;
  for (const key of ['question','answer']) if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 100000 || body[key].includes('\0')) return false;
  const date = body.answered_on;
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date && date <= new Date(now + 86400000).toISOString().slice(0,10);
}
// Called only AFTER onboarding has checked the current case's assignment.
export async function loadSonnyFeedback(db, email) {
  email = normalizeEmail(email);
  if (!validEmail(email)) return {ready:true, replies:[]};
  try {
    const rows = await db(`es2_feedback_replies?email=eq.${encodeURIComponent(email)}&select=${REPLY_FIELDS}&order=answered_on.desc,created_at.desc&limit=101`);
    return {ready:true, replies:rows.slice(0,100), more:rows.length > 100};
  } catch { return {ready:false, replies:[]}; }
}
