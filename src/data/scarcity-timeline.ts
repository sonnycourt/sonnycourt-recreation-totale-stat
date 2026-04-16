export type Purchase = {
  name: string;
  flag: string;
  offsetMs: number;
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
  { name: 'Thomas', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:08:30') },
  { name: 'Sophie', flag: '🇧🇪', offsetMs: toOffset('Jeudi', '21:09:56') },
  { name: 'Nicolas', flag: '🇨🇭', offsetMs: toOffset('Jeudi', '21:11:23') },
  { name: 'Lea', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:12:50') },
  { name: 'Jean-Philippe', flag: '🇨🇦', offsetMs: toOffset('Jeudi', '21:14:04') },
  { name: 'Maxime', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:15:15') },
  { name: 'Charlotte', flag: '🇧🇪', offsetMs: toOffset('Jeudi', '21:19:48') },
  { name: 'Vanessa', flag: '🇨🇭', offsetMs: toOffset('Jeudi', '21:27:33') },
  { name: 'Julien', flag: '🇫🇷', offsetMs: toOffset('Jeudi', '21:38:44') },
  { name: 'Gabrielle', flag: '🇨🇦', offsetMs: toOffset('Jeudi', '21:52:18') },
  { name: 'Vincent', flag: '🇱🇺', offsetMs: toOffset('Jeudi', '22:14:51') },
  { name: 'Manon', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '06:52:08') },
  { name: 'Arnaud', flag: '🇧🇪', offsetMs: toOffset('Vendredi', '10:41:37') },
  { name: 'Romain', flag: '🇨🇭', offsetMs: toOffset('Vendredi', '14:22:41') },
  { name: 'Antoine', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '18:03:57') },
  { name: 'Clara', flag: '🇩🇪', offsetMs: toOffset('Vendredi', '21:34:18') },
  { name: 'Chloe', flag: '🇫🇷', offsetMs: toOffset('Vendredi', '23:11:45') },
  { name: 'Sebastien', flag: '🇨🇭', offsetMs: toOffset('Samedi', '10:47:23') },
  { name: 'Marc-Antoine', flag: '🇨🇦', offsetMs: toOffset('Samedi', '13:52:08') },
  { name: 'Laurent', flag: '🇧🇪', offsetMs: toOffset('Samedi', '15:34:49') },
  { name: 'Emilie', flag: '🇫🇷', offsetMs: toOffset('Samedi', '20:14:37') },
  { name: 'Amelie', flag: '🇱🇺', offsetMs: toOffset('Samedi', '22:48:19') },
  { name: 'Quentin', flag: '🇫🇷', offsetMs: toOffset('Dimanche', '08:23:55') },
  { name: 'Elodie', flag: '🇨🇭', offsetMs: toOffset('Dimanche', '09:12:41') },
  { name: 'Camille', flag: '🇫🇷', offsetMs: toOffset('Dimanche', '09:58:27') },
  { name: 'Benoit', flag: '🇧🇪', offsetMs: toOffset('Dimanche', '14:37:09') },
  { name: 'Stephanie', flag: '🇨🇦', offsetMs: toOffset('Dimanche', '15:48:22') },
  { name: 'Alexandre', flag: '🇲🇨', offsetMs: toOffset('Dimanche', '18:22:44') },
  { name: 'Sarah', flag: '🇫🇷', offsetMs: toOffset('Dimanche', '20:51:16') },
  { name: 'Lucas', flag: '🇫🇷', offsetMs: toOffset('Dimanche', '22:57:38') },
];

export const TOTAL_SEATS = 30;

