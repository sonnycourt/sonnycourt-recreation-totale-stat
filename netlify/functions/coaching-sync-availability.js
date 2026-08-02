import crypto from 'crypto';
import { googleAccessTokenForCoach } from './lib/coaching-google.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function publicKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }

function zonedParts(date, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return values;
}

function localToUtc(dateText, timeText, timeZone) {
  const [year, month, day] = dateText.split('-').map(Number);
  const [hour, minute] = timeText.slice(0, 5).split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(target);
  for (let index = 0; index < 2; index += 1) {
    const parts = zonedParts(guess, timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess = new Date(guess.getTime() + target - shown);
  }
  return guess;
}

function dateTextInZone(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function minutes(value) {
  const [hour, minute] = String(value).slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

async function resolveCoach(req, requestedSlug) {
  const syncSecret = req.headers.get('x-coaching-sync-secret');
  const expectedSecret = process.env.COACHING_SYNC_SECRET || '';
  let validSyncSecret = false;
  try {
    validSyncSecret = Boolean(expectedSecret && syncSecret && syncSecret.length === expectedSecret.length && crypto.timingSafeEqual(Buffer.from(syncSecret), Buffer.from(expectedSecret)));
  } catch {}
  if (validSyncSecret) {
    const found = await supabaseGet(`coaching_coaches?slug=eq.${encodeURIComponent(requestedSlug || 'romain')}&status=eq.active&select=id,slug,google_calendar_id&limit=1`);
    return found.ok && Array.isArray(found.data) ? found.data[0] : null;
  }
  const authorization = req.headers.get('authorization') || '';
  const key = publicKey();
  if (!authorization.startsWith('Bearer ') || !key || !process.env.SUPABASE_URL) return null;
  const userResponse = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: key, Authorization: authorization } });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !user.id) return null;
  const found = await supabaseGet(`coaching_coaches?auth_user_id=eq.${user.id}&select=id,slug,google_calendar_id&limit=1`);
  return found.ok && Array.isArray(found.data) ? found.data[0] : null;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const body = await req.json().catch(() => ({}));
  const coach = await resolveCoach(req, String(body.coach_slug || '').slice(0, 80));
  if (!coach) return json(401, { error: 'Accès coach requis.' });
  const token = await googleAccessTokenForCoach(coach.id).catch(() => null);
  if (!token) return json(409, { error: 'Connecte d’abord Google Calendar.' });
  const rulesResult = await supabaseGet(`coaching_availability_rules?coach_id=eq.${coach.id}&active=eq.true&select=weekday,start_time,end_time,slot_minutes,buffer_minutes,timezone`);
  if (!rulesResult.ok) return json(502, { error: 'Impossible de lire les disponibilités.' });
  const rules = rulesResult.ok && Array.isArray(rulesResult.data) ? rulesResult.data : [];
  if (!rules.length) return json(409, { error: 'Ajoute au moins une plage de disponibilité.' });

  const timeMin = new Date();
  const timeMax = new Date(Date.now() + 45 * 86400000);
  const calendarId = coach.google_calendar_id || 'primary';
  const busyResponse = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
  });
  const busyData = await busyResponse.json().catch(() => ({}));
  if (!busyResponse.ok) return json(502, { error: 'Google Calendar ne répond pas.' });
  const busy = busyData.calendars?.[calendarId]?.busy || [];
  const candidates = [];

  for (let offset = 0; offset < 45; offset += 1) {
    const marker = new Date(Date.now() + offset * 86400000 + 12 * 3600000);
    for (const rule of rules) {
      const dateText = dateTextInZone(marker, rule.timezone);
      const [year, month, day] = dateText.split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
      if (weekday !== Number(rule.weekday)) continue;
      for (let cursor = minutes(rule.start_time); cursor + Number(rule.slot_minutes) <= minutes(rule.end_time); cursor += Number(rule.slot_minutes) + Number(rule.buffer_minutes)) {
        const timeText = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
        const start = localToUtc(dateText, timeText, rule.timezone);
        const end = new Date(start.getTime() + Number(rule.slot_minutes) * 60000);
        if (start <= new Date(Date.now() + 2 * 3600000)) continue;
        const unavailable = busy.some((period) => start < new Date(period.end) && end > new Date(period.start));
        if (!unavailable) candidates.push({ coach_id: coach.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: 'available', source: 'google' });
      }
    }
  }

  const uniqueCandidates = [...new Map(candidates.map((slot) => [slot.starts_at, slot])).values()];

  const existingResult = await supabaseGet(`coaching_availability_slots?coach_id=eq.${coach.id}&source=eq.google&starts_at=gte.${encodeURIComponent(timeMin.toISOString())}&starts_at=lte.${encodeURIComponent(timeMax.toISOString())}&select=id,starts_at,status`);
  if (!existingResult.ok) return json(502, { error: 'Impossible de lire les créneaux existants.' });
  const existing = existingResult.ok && Array.isArray(existingResult.data) ? existingResult.data : [];
  const byStart = new Map(existing.map((slot) => [new Date(slot.starts_at).toISOString(), slot]));
  const wanted = new Set(uniqueCandidates.map((slot) => slot.starts_at));
  const blockedResults = await Promise.all(existing.filter((slot) => slot.status === 'available' && !wanted.has(new Date(slot.starts_at).toISOString())).map((slot) => supabasePatch('coaching_availability_slots', `id=eq.${slot.id}&status=eq.available`, { status: 'blocked' })));
  if (blockedResults.some((result) => !result.ok)) return json(502, { error: 'Synchronisation incomplète des anciens créneaux.' });
  const inserts = uniqueCandidates.filter((slot) => !byStart.has(slot.starts_at));
  const reopens = uniqueCandidates.filter((slot) => byStart.get(slot.starts_at)?.status === 'blocked');
  if (inserts.length) {
    const inserted = await supabasePost('coaching_availability_slots', inserts, { prefer: 'return=minimal' });
    if (!inserted.ok) return json(502, { error: 'Impossible d’ajouter les nouveaux créneaux.' });
  }
  const reopenedResults = await Promise.all(reopens.map((slot) => supabasePatch('coaching_availability_slots', `id=eq.${byStart.get(slot.starts_at).id}&status=eq.blocked`, { status: 'available', ends_at: slot.ends_at })));
  if (reopenedResults.some((result) => !result.ok)) return json(502, { error: 'Synchronisation incomplète des créneaux rouverts.' });
  return json(200, { ok: true, available: uniqueCandidates.length, added: inserts.length, reopened: reopens.length });
};
