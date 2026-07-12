/**
 * Week-end d'appels closers (RDV en ligne /rdv) — fuseau Europe/Paris.
 * Ancré sur le jeudi de session webinaire (20h Paris) : on propose le premier
 * jeudi NON skippé dont le dimanche 23h est encore à venir, donc pendant le
 * week-end en cours la grille reste sur ce week-end.
 * Plages : vendredi 16h-21h, samedi 10h-21h, dimanche 10h-21h, pas de 30 min.
 */

import {
  parseParisParts,
  addDaysParisCalendar,
  findParisInstantUtc,
  SKIP_SESSION_DATES,
} from './webinaire-session-paris.mjs';

const SLOT_MINUTES = 30;
// [heure début, heure fin] Paris par jour du week-end.
const DAY_HOURS = { fri: [13, 21], sat: [10, 21], sun: [10, 21] };

function pad(n) {
  return String(n).padStart(2, '0');
}

function keyOf(p) {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function weekdayOf(parts) {
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  return parseParisParts(probe).weekdayText;
}

/** Jeudi de session dont le week-end d'appels est en cours ou à venir. */
export function getCallWeekend(now = new Date()) {
  const today = parseParisParts(now);
  for (let delta = -7; delta <= 28; delta += 1) {
    const d = addDaysParisCalendar(today.year, today.month, today.day, delta);
    if (!weekdayOf(d).startsWith('jeu')) continue;
    if (SKIP_SESSION_DATES.includes(keyOf(d))) continue;
    const sun = addDaysParisCalendar(d.year, d.month, d.day, 3);
    const weekendEnd = findParisInstantUtc(sun.year, sun.month, sun.day, 23);
    if (!weekendEnd || weekendEnd.getTime() <= now.getTime()) continue;
    return {
      thu: d,
      fri: addDaysParisCalendar(d.year, d.month, d.day, 1),
      sat: addDaysParisCalendar(d.year, d.month, d.day, 2),
      sun,
    };
  }
  return null;
}

const FR_DAY = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const FR_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Grille complète des créneaux candidats du week-end.
 * @returns {{days:[{key,title,slots:[{start,end,label}]}], deadline:string}|null}
 */
export function getWeekendSlotGrid(now = new Date()) {
  const wk = getCallWeekend(now);
  if (!wk) return null;
  const days = [];
  for (const [dayKey, d] of [
    ['fri', wk.fri],
    ['sat', wk.sat],
    ['sun', wk.sun],
  ]) {
    const [h1, h2] = DAY_HOURS[dayKey];
    const start = findParisInstantUtc(d.year, d.month, d.day, h1);
    const end = findParisInstantUtc(d.year, d.month, d.day, h2);
    if (!start || !end) continue;
    const slots = [];
    for (let t = start.getTime(); t + SLOT_MINUTES * 60000 <= end.getTime(); t += SLOT_MINUTES * 60000) {
      slots.push({
        start: new Date(t).toISOString(),
        end: new Date(t + SLOT_MINUTES * 60000).toISOString(),
        label: FR_TIME.format(new Date(t)),
      });
    }
    days.push({ key: keyOf(d), title: FR_DAY.format(start), slots });
  }
  if (!days.length) return null;
  // Deadline pour remplir ses dispos = premier créneau du vendredi (13h Paris).
  const deadline = findParisInstantUtc(wk.fri.year, wk.fri.month, wk.fri.day, 13);
  return { days, deadline: deadline ? deadline.toISOString() : null };
}
