import crypto from 'crypto';
import { googleAccessTokenForCoach } from './lib/coaching-google.mjs';
import { supabaseGet, supabasePatch, supabasePost } from './lib/supabase-rest.mjs';

const ATOM_MINUTES = 15;
const FIRST_CONSULTATION_MINUTES = 45;

function json(status, body) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function publicKey() { return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY; }

function zonedParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
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

async function inBatches(items, operation, size = 20) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(operation)));
  }
  return results;
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

function diagnosticCandidates(atoms, timeZone) {
  const byStart = new Map(atoms.map((slot) => [slot.starts_at, slot]));
  return atoms.flatMap((slot) => {
    const start = new Date(slot.starts_at);
    if (zonedParts(start, timeZone).minute % 30 !== 0) return [];
    const second = byStart.get(new Date(start.getTime() + ATOM_MINUTES * 60000).toISOString());
    const third = byStart.get(new Date(start.getTime() + 2 * ATOM_MINUTES * 60000).toISOString());
    if (!second || !third) return [];
    return [{
      coach_slug: 'romain',
      starts_at: slot.starts_at,
      ends_at: new Date(start.getTime() + FIRST_CONSULTATION_MINUTES * 60000).toISOString(),
      status: 'available',
    }];
  });
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  const body = await req.json().catch(() => ({}));
  const coach = await resolveCoach(req, String(body.coach_slug || '').slice(0, 80));
  if (!coach) return json(401, { error: 'Accès coach requis.' });
  const token = await googleAccessTokenForCoach(coach.id).catch(() => null);
  if (!token) return json(409, { error: 'Connecte d’abord Google Calendar.' });
  const rulesResult = await supabaseGet(`coaching_availability_rules?coach_id=eq.${coach.id}&active=eq.true&select=weekday,start_time,end_time,timezone`);
  if (!rulesResult.ok) return json(502, { error: 'Impossible de lire les disponibilités.' });
  const rules = Array.isArray(rulesResult.data) ? rulesResult.data : [];
  if (!rules.length) return json(409, { error: 'Ajoute au moins une plage de disponibilité.' });

  const timeMin = new Date();
  const timeMax = new Date(Date.now() + 45 * 86400000);
  const calendarId = coach.google_calendar_id || 'primary';
  const busyResponse = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] }),
  });
  const busyData = await busyResponse.json().catch(() => ({}));
  if (!busyResponse.ok) return json(502, { error: 'Google Calendar ne répond pas.' });
  const busy = busyData.calendars?.[calendarId]?.busy || [];
  const candidates = [];

  for (let offset = 0; offset < 45; offset += 1) {
    const marker = new Date(Date.now() + offset * 86400000 + 12 * 3600000);
    for (const rule of rules) {
      const timeZone = rule.timezone || 'Europe/Zurich';
      const dateText = dateTextInZone(marker, timeZone);
      const [year, month, day] = dateText.split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
      if (weekday !== Number(rule.weekday)) continue;
      for (let cursor = minutes(rule.start_time); cursor + ATOM_MINUTES <= minutes(rule.end_time); cursor += ATOM_MINUTES) {
        const timeText = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
        const start = localToUtc(dateText, timeText, timeZone);
        const end = new Date(start.getTime() + ATOM_MINUTES * 60000);
        if (start <= new Date(Date.now() + 2 * 3600000)) continue;
        const unavailable = busy.some((period) => start < new Date(period.end) && end > new Date(period.start));
        if (!unavailable) candidates.push({ coach_id: coach.id, starts_at: start.toISOString(), ends_at: end.toISOString(), status: 'available', source: 'google' });
      }
    }
  }

  const atoms = [...new Map(candidates.map((slot) => [slot.starts_at, slot])).values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const existingResult = await supabaseGet(`coaching_availability_slots?coach_id=eq.${coach.id}&starts_at=gte.${encodeURIComponent(timeMin.toISOString())}&starts_at=lt.${encodeURIComponent(timeMax.toISOString())}&select=id,starts_at,ends_at,status,source`);
  if (!existingResult.ok) return json(502, { error: 'Impossible de lire les créneaux existants.' });
  const existing = Array.isArray(existingResult.data) ? existingResult.data : [];
  const byStart = new Map(existing.map((slot) => [new Date(slot.starts_at).toISOString(), slot]));
  const wanted = new Map(atoms.map((slot) => [slot.starts_at, slot]));

  const toBlock = existing.filter((slot) => slot.source === 'google' && slot.status === 'available' && !wanted.has(new Date(slot.starts_at).toISOString()));
  const toNormalize = atoms.filter((slot) => {
    const current = byStart.get(slot.starts_at);
    return current && ['available', 'blocked'].includes(current.status)
      && (current.status !== 'available' || new Date(current.ends_at).toISOString() !== slot.ends_at);
  });
  const inserts = atoms.filter((slot) => !byStart.has(slot.starts_at));

  const blockedResults = await inBatches(toBlock, (slot) => supabasePatch('coaching_availability_slots', `id=eq.${slot.id}&status=eq.available`, { status: 'blocked', held_until: null }));
  if (blockedResults.some((result) => !result.ok)) return json(502, { error: 'Synchronisation incomplète des anciens créneaux.' });
  if (inserts.length) {
    const inserted = await supabasePost('coaching_availability_slots', inserts, { prefer: 'return=minimal' });
    if (!inserted.ok) return json(502, { error: 'Impossible d’ajouter les nouveaux créneaux.' });
  }
  const normalizedResults = await inBatches(toNormalize, (slot) => supabasePatch(
    'coaching_availability_slots',
    `id=eq.${byStart.get(slot.starts_at).id}&status=in.(available,blocked)`,
    { status: 'available', ends_at: slot.ends_at, held_until: null },
  ));
  if (normalizedResults.some((result) => !result.ok)) return json(502, { error: 'Synchronisation incomplète des créneaux rouverts.' });

  let diagnosticAvailable = 0;
  if (coach.slug === 'romain') {
    const diagnostic = diagnosticCandidates(atoms, rules[0]?.timezone || 'Europe/Zurich');
    const diagnosticExistingResult = await supabaseGet(`coach_diagnostic_slots?coach_slug=eq.romain&starts_at=gte.${encodeURIComponent(timeMin.toISOString())}&starts_at=lt.${encodeURIComponent(timeMax.toISOString())}&select=id,starts_at,ends_at,status`);
    if (!diagnosticExistingResult.ok) return json(502, { error: 'Impossible de synchroniser les premières consultations.' });
    const diagnosticExisting = Array.isArray(diagnosticExistingResult.data) ? diagnosticExistingResult.data : [];
    const diagnosticByStart = new Map(diagnosticExisting.map((slot) => [new Date(slot.starts_at).toISOString(), slot]));
    const diagnosticWanted = new Map(diagnostic.map((slot) => [slot.starts_at, slot]));
    const diagnosticToBlock = diagnosticExisting.filter((slot) => slot.status === 'available' && !diagnosticWanted.has(new Date(slot.starts_at).toISOString()));
    const diagnosticToNormalize = diagnostic.filter((slot) => {
      const current = diagnosticByStart.get(slot.starts_at);
      return current && ['available', 'blocked'].includes(current.status)
        && (current.status !== 'available' || new Date(current.ends_at).toISOString() !== slot.ends_at);
    });
    const diagnosticInserts = diagnostic.filter((slot) => !diagnosticByStart.has(slot.starts_at));
    const diagnosticBlockedResults = await inBatches(diagnosticToBlock, (slot) => supabasePatch('coach_diagnostic_slots', `id=eq.${slot.id}&status=eq.available`, { status: 'blocked', held_until: null }));
    if (diagnosticBlockedResults.some((result) => !result.ok)) return json(502, { error: 'Synchronisation incomplète des premières consultations.' });
    if (diagnosticInserts.length) {
      const inserted = await supabasePost('coach_diagnostic_slots', diagnosticInserts, { prefer: 'return=minimal' });
      if (!inserted.ok) return json(502, { error: 'Impossible d’ajouter les premières consultations.' });
    }
    const diagnosticNormalizedResults = await inBatches(diagnosticToNormalize, (slot) => supabasePatch(
      'coach_diagnostic_slots',
      `id=eq.${diagnosticByStart.get(slot.starts_at).id}&status=in.(available,blocked)`,
      { status: 'available', ends_at: slot.ends_at, held_until: null },
    ));
    if (diagnosticNormalizedResults.some((result) => !result.ok)) return json(502, { error: 'Synchronisation incomplète des premières consultations.' });
    diagnosticAvailable = diagnostic.length;
  }

  return json(200, {
    ok: true,
    available: atoms.length,
    diagnostic_available: diagnosticAvailable,
    added: inserts.length,
    normalized: toNormalize.length,
  });
};
