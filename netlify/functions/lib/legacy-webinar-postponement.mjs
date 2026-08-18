// Europe/Paris is UTC+2 on 20 August 2026. Use the whole local calendar day
// (and the explicit 20h slot below) so a harmless timestamp precision change
// cannot let one registration from this cohort through.
const POSTPONED_LOCAL_DAY_START_MS = Date.parse('2026-08-19T22:00:00.000Z');
const POSTPONED_LOCAL_DAY_END_MS = Date.parse('2026-08-20T22:00:00.000Z');

export const LEGACY_WEBINAR_POSTPONEMENT = Object.freeze({
  localDate: '2026-08-20',
  slot: '20h',
  title: 'Cette session a été reportée',
  message:
    'La nouvelle date et ton lien personnel te seront envoyés dans les prochains jours. Tu n’as rien à faire et ta place reste bien enregistrée.',
});

export function isLegacyWebinarPostponed(row) {
  if (String(row?.creneau || '').trim().toLowerCase() !== LEGACY_WEBINAR_POSTPONEMENT.slot) {
    return false;
  }

  const sessionStartMs = Date.parse(String(row?.session_date || ''));
  return Number.isFinite(sessionStartMs)
    && sessionStartMs >= POSTPONED_LOCAL_DAY_START_MS
    && sessionStartMs < POSTPONED_LOCAL_DAY_END_MS;
}
