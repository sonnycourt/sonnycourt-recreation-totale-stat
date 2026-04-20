export type Purchase = {
  name: string;
  flag: string;
  offsetMs: number;
  phase: 1 | 2;
};

const DAY_OFFSETS: Record<string, number> = {
  Jeudi: 0,
  Vendredi: 1,
  Samedi: 2,
  Dimanche: 3,
};

const WINDOW_START_H = 21;
const WINDOW_START_M = 7;
const WINDOW_START_S = 12;

export function toOffset(day: keyof typeof DAY_OFFSETS, hhmmss: string): number {
  const dayOffset = DAY_OFFSETS[day];
  if (dayOffset == null) throw new Error(`Unknown day: ${day}`);
  const [hRaw, mRaw, sRaw] = hhmmss.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  const s = Number(sRaw);
  if (![h, m, s].every(Number.isFinite)) throw new Error(`Invalid time: ${hhmmss}`);
  const fromStartSec =
    dayOffset * 24 * 3600 +
    (h * 3600 + m * 60 + s) -
    (WINDOW_START_H * 3600 + WINDOW_START_M * 60 + WINDOW_START_S);
  return Math.max(0, fromStartSec * 1000);
}

export const WEEKLY_TIMELINE: Purchase[] = [
  { name: 'Thomas', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:07:12'), phase: 1 },
  { name: 'Sophie', flag: '🇧🇪', offsetMs: toOffset('Jeudi', '21:07:38'), phase: 1 },
  { name: 'Nicolas', flag: '🇨🇭', offsetMs: toOffset('Jeudi', '21:07:55'), phase: 1 },
  { name: 'Lea', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:08:14'), phase: 1 },
  { name: 'Jean-Philippe', flag: '🇨🇦', offsetMs: toOffset('Jeudi', '21:08:42'), phase: 1 },
  { name: 'Maxime', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:09:18'), phase: 1 },
  { name: 'Charlotte', flag: '🇧🇪', offsetMs: toOffset('Jeudi', '21:09:47'), phase: 1 },
  { name: 'Vanessa', flag: '🇨🇭', offsetMs: toOffset('Jeudi', '21:10:23'), phase: 1 },
  { name: 'Julien', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:11:05'), phase: 1 },
  { name: 'Gabrielle', flag: '🇨🇦', offsetMs: toOffset('Jeudi', '21:11:48'), phase: 1 },
  { name: 'Vincent', flag: '🇱🇺', offsetMs: toOffset('Jeudi', '21:15:22'), phase: 1 },
  { name: 'Manon', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:17:45'), phase: 1 },
  { name: 'Arnaud', flag: '🇧🇪', offsetMs: toOffset('Jeudi', '21:20:18'), phase: 1 },
  { name: 'Romain', flag: '🇨🇭', offsetMs: toOffset('Jeudi', '21:23:41'), phase: 1 },
  { name: 'Antoine', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:27:33'), phase: 1 },
  { name: 'Clara', flag: '🇩🇪', offsetMs: toOffset('Jeudi', '21:31:12'), phase: 1 },
  { name: 'Chloe', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:36:48'), phase: 1 },
  { name: 'Sebastien', flag: '🇨🇭', offsetMs: toOffset('Jeudi', '21:43:15'), phase: 1 },
  { name: 'Marc-Antoine', flag: '🇨🇦', offsetMs: toOffset('Jeudi', '21:52:34'), phase: 1 },
  { name: 'Laurent', flag: '🇧🇪', offsetMs: toOffset('Jeudi', '22:08:47'), phase: 1 },
  { name: 'Emilie', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '22:31:19'), phase: 1 },
  { name: 'Amelie', flag: '🇱🇺', offsetMs: toOffset('Jeudi', '22:54:08'), phase: 1 },
  { name: 'Quentin', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '23:28:33'), phase: 1 },
  { name: 'Elodie', flag: '🇨🇭', offsetMs: toOffset('Vendredi', '01:14:22'), phase: 1 },
  { name: 'Camille', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '04:37:51'), phase: 1 },
  { name: 'Benoit', flag: '🇧🇪', offsetMs: toOffset('Vendredi', '07:12:18'), phase: 1 },
  { name: 'Stephanie', flag: '🇨🇦', offsetMs: toOffset('Vendredi', '07:48:42'), phase: 1 },
  { name: 'Alexandre', flag: '🇲🇨', offsetMs: toOffset('Vendredi', '08:23:15'), phase: 1 },
  { name: 'Sarah', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '09:11:37'), phase: 1 },
  { name: 'Lucas', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '09:47:08'), phase: 1 },
  { name: 'Ines', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '14:12:33'), phase: 2 },
  { name: 'Hugo', flag: '🇧🇪', offsetMs: toOffset('Vendredi', '18:34:17'), phase: 2 },
  { name: 'Margot', flag: '🇨🇭', offsetMs: toOffset('Vendredi', '22:47:42'), phase: 2 },
  { name: 'Pierre', flag: '🇫🇷', offsetMs: toOffset('Samedi', '09:15:28'), phase: 2 },
  { name: 'Oceane', flag: '🇨🇦', offsetMs: toOffset('Samedi', '14:38:51'), phase: 2 },
  { name: 'Raphael', flag: '🇫🇷', offsetMs: toOffset('Samedi', '19:22:14'), phase: 2 },
  { name: 'Pauline', flag: '🇧🇪', offsetMs: toOffset('Samedi', '23:45:33'), phase: 2 },
  { name: 'Theo', flag: '🇨🇭', offsetMs: toOffset('Dimanche', '10:18:47'), phase: 2 },
  { name: 'Marie', flag: '🇫🇷', offsetMs: toOffset('Dimanche', '15:42:22'), phase: 2 },
  { name: 'Victor', flag: '🇫🇷', offsetMs: toOffset('Dimanche', '20:08:15'), phase: 2 },
];

export const PHASE1_SEATS = 30;
export const PHASE2_SEATS = 10;
// Phase 2 opens immediately when phase 1 reaches 0 (Lucas at 09:47:08).
export const PHASE2_START_OFFSET = toOffset('Vendredi', '09:47:08');
export const TOTAL_SEATS = PHASE1_SEATS + PHASE2_SEATS;

