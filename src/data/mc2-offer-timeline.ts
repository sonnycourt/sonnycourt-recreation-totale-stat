import type { Purchase } from './scarcity-timeline';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const FIRST_DAY_END_MS = 24 * HOUR_MS;
const SECOND_DAY_END_MS = 48 * HOUR_MS;

const BUYERS: Array<Pick<Purchase, 'name' | 'flag'>> = [
  { name: 'Thomas', flag: '🇫🇷' },
  { name: 'Sophie', flag: '🇧🇪' },
  { name: 'Nicolas', flag: '🇨🇭' },
  { name: 'Lea', flag: '🇫🇷' },
  { name: 'Jean-Philippe', flag: '🇨🇦' },
  { name: 'Maxime', flag: '🇫🇷' },
  { name: 'Charlotte', flag: '🇧🇪' },
  { name: 'Vanessa', flag: '🇨🇭' },
  { name: 'Julien', flag: '🇫🇷' },
  { name: 'Gabrielle', flag: '🇨🇦' },
  { name: 'Vincent', flag: '🇱🇺' },
  { name: 'Manon', flag: '🇫🇷' },
  { name: 'Arnaud', flag: '🇧🇪' },
  { name: 'Romain', flag: '🇨🇭' },
  { name: 'Antoine', flag: '🇫🇷' },
  { name: 'Clara', flag: '🇩🇪' },
  { name: 'Chloe', flag: '🇫🇷' },
  { name: 'Sebastien', flag: '🇨🇭' },
  { name: 'Marc-Antoine', flag: '🇨🇦' },
  { name: 'Laurent', flag: '🇧🇪' },
  { name: 'Emilie', flag: '🇫🇷' },
  { name: 'Amelie', flag: '🇱🇺' },
  { name: 'Quentin', flag: '🇫🇷' },
  { name: 'Elodie', flag: '🇨🇭' },
  { name: 'Camille', flag: '🇫🇷' },
  { name: 'Benoit', flag: '🇧🇪' },
  { name: 'Stephanie', flag: '🇨🇦' },
  { name: 'Alexandre', flag: '🇲🇨' },
  { name: 'Sarah', flag: '🇫🇷' },
  { name: 'Lucas', flag: '🇫🇷' },
  { name: 'Ines', flag: '🇫🇷' },
  { name: 'Hugo', flag: '🇧🇪' },
  { name: 'Margot', flag: '🇨🇭' },
  { name: 'Pierre', flag: '🇫🇷' },
  { name: 'Oceane', flag: '🇨🇦' },
  { name: 'Raphael', flag: '🇫🇷' },
  { name: 'Pauline', flag: '🇧🇪' },
];

// 17 places sont attribuées entre le CTA et H+24 : 37 → 20.
// Les deux premières baisses sont volontairement fixées à +3 min et +6 min.
const FIRST_DAY_OFFSETS_MS = [
  3 * MINUTE_MS,
  6 * MINUTE_MS,
  12 * MINUTE_MS,
  20 * MINUTE_MS,
  32 * MINUTE_MS,
  48 * MINUTE_MS,
  70 * MINUTE_MS,
  100 * MINUTE_MS,
  150 * MINUTE_MS,
  3.25 * HOUR_MS,
  4.75 * HOUR_MS,
  6.5 * HOUR_MS,
  8.5 * HOUR_MS,
  11 * HOUR_MS,
  14 * HOUR_MS,
  18 * HOUR_MS,
  FIRST_DAY_END_MS,
];

// 15 places supplémentaires sont attribuées entre H+24 et H+48 : 20 → 5.
const SECOND_DAY_OFFSETS_MS = [
  25.5 * HOUR_MS,
  27 * HOUR_MS,
  28.5 * HOUR_MS,
  30 * HOUR_MS,
  31.5 * HOUR_MS,
  33 * HOUR_MS,
  34.5 * HOUR_MS,
  36 * HOUR_MS,
  38 * HOUR_MS,
  40 * HOUR_MS,
  42 * HOUR_MS,
  44 * HOUR_MS,
  45.5 * HOUR_MS,
  47 * HOUR_MS,
  SECOND_DAY_END_MS,
];

const FINAL_PHASE_FRACTIONS = [0.2, 0.4, 0.6, 0.8, 1];

/**
 * Construit la cadence MC2 relativement au CTA.
 * Les cinq dernières places sont espacées sur tout le temps réellement restant,
 * de H+48 jusqu'à l'expiration globale de l'offre.
 */
export function createMc2OfferTimeline(windowDurationMs: number): Purchase[] {
  const durationMs = Number.isFinite(windowDurationMs)
    ? Math.max(SECOND_DAY_END_MS + 5 * MINUTE_MS, windowDurationMs)
    : 72 * HOUR_MS;
  const finalOffsetMs = Math.max(
    SECOND_DAY_END_MS + 5 * MINUTE_MS,
    durationMs,
  );
  const finalSpanMs = finalOffsetMs - SECOND_DAY_END_MS;
  const finalOffsetsMs = FINAL_PHASE_FRACTIONS.map((fraction) => (
    Math.round(SECOND_DAY_END_MS + finalSpanMs * fraction)
  ));
  const offsetsMs = [
    ...FIRST_DAY_OFFSETS_MS,
    ...SECOND_DAY_OFFSETS_MS,
    ...finalOffsetsMs,
  ];

  return BUYERS.map((buyer, index) => ({
    ...buyer,
    offsetMs: offsetsMs[index],
    phase: index < FIRST_DAY_OFFSETS_MS.length ? 1 : 2,
  }));
}

export const MC2_OFFER_TIMELINE_PURCHASES = BUYERS.length;
