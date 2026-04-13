/**
 * Dates / sessions webinaire ES 2.0 — fuseau Europe/Paris.
 * Cutoff inscriptions : avant jeudi 19h (Paris) → CE jeudi 20h ; à partir de jeudi 19h → jeudi SUIVANT 20h.
 */

export function parseParisParts(date) {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const value = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const weekRaw = parts.find((p) => p.type === 'weekday')?.value || '';
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
    weekdayText: weekRaw.toLowerCase(),
  };
}

function getParisWeekdayNumber(parts) {
  const dayMap = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };
  for (const [key, val] of Object.entries(dayMap)) {
    if (parts.weekdayText.startsWith(key)) return val;
  }
  return 1;
}

/** Ajoute des jours au calendrier en passant par une date UTC midi (évite dérives). */
export function addDaysParisCalendar(year, month, day, deltaDays) {
  const d = new Date(Date.UTC(year, month - 1, day + deltaDays, 12, 0, 0));
  const p = parseParisParts(d);
  return { year: p.year, month: p.month, day: p.day };
}

export function findParisInstantUtc(parisYear, parisMonth, parisDay, parisHour) {
  let candidate = new Date(Date.UTC(parisYear, parisMonth - 1, parisDay, parisHour - 1, 0, 0));
  for (let i = 0; i < 4000; i++) {
    const p = parseParisParts(candidate);
    if (p.year === parisYear && p.month === parisMonth && p.day === parisDay && p.hour === parisHour) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 60 * 1000);
  }

  // Fallback robuste : on balaie 48h autour de la date cible.
  // Utile si l'environnement runtime a un comportement Intl inattendu.
  const broadStart = Date.UTC(parisYear, parisMonth - 1, parisDay, 0, 0, 0);
  const broadEnd = broadStart + 48 * 60 * 60 * 1000;
  for (let t = broadStart; t < broadEnd; t += 60 * 1000) {
    const p = parseParisParts(new Date(t));
    if (p.year === parisYear && p.month === parisMonth && p.day === parisDay && p.hour === parisHour) {
      return new Date(t);
    }
  }

  return null;
}

/**
 * Jeudi « cible » pour les inscriptions (date calendaire Paris Y/M/D).
 * Si maintenant < jeudi 19h (Paris) de cette semaine → ce jeudi ; sinon jeudi dans 7 jours.
 */
export function getMarketingThursdayDateParts(now = new Date()) {
  const parisNow = parseParisParts(now);
  const dow = getParisWeekdayNumber(parisNow);
  const daysFromMonday = dow - 1;
  const mon = addDaysParisCalendar(parisNow.year, parisNow.month, parisNow.day, -daysFromMonday);
  const thu = addDaysParisCalendar(mon.year, mon.month, mon.day, 3);

  const thu19 = findParisInstantUtc(thu.year, thu.month, thu.day, 19);
  if (!thu19) return thu;

  if (now.getTime() < thu19.getTime()) {
    return thu;
  }
  return addDaysParisCalendar(thu.year, thu.month, thu.day, 7);
}

/**
 * Instant UTC de début de session pour une nouvelle inscription (créneau unique : jeudi 20h Paris).
 * @param {'14h'|'20h'} [_creneau] — ignoré, conservé pour compatibilité API
 */
export function getRegistrationSessionInstantUtc(now, _creneau) {
  const thu = getMarketingThursdayDateParts(now);
  return findParisInstantUtc(thu.year, thu.month, thu.day, 20);
}

const SESSION_MS = 45 * 60 * 1000;

export function getSessionEndsAtUtc(sessionStartUtc) {
  if (!sessionStartUtc) return null;
  return new Date(new Date(sessionStartUtc).getTime() + SESSION_MS);
}

/**
 * Dimanche 23h (Paris) de la même semaine que le jeudi de session (jeudi + 3 jours).
 */
export function getOffreExpiresAtUtc(sessionStartUtc) {
  if (!sessionStartUtc) return null;
  const p = parseParisParts(new Date(sessionStartUtc));
  const sun = addDaysParisCalendar(p.year, p.month, p.day, 3);
  return findParisInstantUtc(sun.year, sun.month, sun.day, 23);
}

/**
 * Prochain instant à afficher pour countdown (jeudi 20h sur le jeudi marketing).
 */
export function getMarketingCountdownTargetUtc(now = new Date()) {
  const thu = getMarketingThursdayDateParts(now);
  const t20 = findParisInstantUtc(thu.year, thu.month, thu.day, 20);
  if (!t20) return null;
  if (now.getTime() < t20.getTime()) return t20;
  const nextThu = addDaysParisCalendar(thu.year, thu.month, thu.day, 7);
  return findParisInstantUtc(nextThu.year, nextThu.month, nextThu.day, 20);
}

/**
 * Horodatage opt-in pour champ MailerLite : jj.mm.aaaa HH:mm:ss (Europe/Paris).
 * Ex. 22.03.2026 17:45:03
 */
export function formatParisOptinTimestamp(date = new Date()) {
  const d = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = d.formatToParts(date);
  const get = (type) => parts.find((x) => x.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** @deprecated — préférer getRegistrationSessionInstantUtc */
export function getNextThursdaySlotUtc(now, parisHour) {
  const creneau = parisHour === 20 ? '20h' : '14h';
  return getRegistrationSessionInstantUtc(now, creneau);
}
