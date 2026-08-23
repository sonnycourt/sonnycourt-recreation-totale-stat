export const MC2_SESSION_TOTAL_SEATS = 15;
export const MC2_SESSION_OFFER_DURATION_MS = 24 * 60 * 60 * 1000;
export const MC2_SESSION_HALF_WINDOW_MS = 12 * 60 * 60 * 1000;

const minute = 60 * 1000;
const hour = 60 * minute;

// Source de vérité du simulateur MODE TEST. Les offsets sont tous calculés à
// partir de l'apparition/activation du CTA. La dernière place reste achetable
// jusqu'à l'expiration exacte du countdown, 24 heures après le CTA.
export const MC2_SESSION_PURCHASE_TIMELINE = [
  { name: 'Sophie', gender: 'female', flag: '🇧🇪', offsetMs: 3 * minute },
  { name: 'Nicolas', gender: 'male', flag: '🇨🇭', offsetMs: 5 * minute },
  { name: 'Thomas', gender: 'male', flag: '🇫🇷', offsetMs: 12 * minute },
  { name: 'Gabrielle', gender: 'female', flag: '🇨🇦', offsetMs: 13 * minute },
  { name: 'Charlotte', gender: 'female', flag: '🇧🇪', offsetMs: 17 * minute },
  { name: 'Vanessa', gender: 'female', flag: '🇨🇭', offsetMs: 49 * minute },
  { name: 'Julien', gender: 'male', flag: '🇫🇷', offsetMs: 1 * hour + 10 * minute },
  { name: 'Manon', gender: 'female', flag: '🇫🇷', offsetMs: 3 * hour + 15 * minute },
  { name: 'Arnaud', gender: 'male', flag: '🇧🇪', offsetMs: 8 * hour + 30 * minute },
  { name: 'Clara', gender: 'female', flag: '🇩🇪', offsetMs: 12 * hour },
  { name: 'Hugo', gender: 'male', flag: '🇧🇪', offsetMs: 13 * hour + 30 * minute },
  { name: 'Margot', gender: 'female', flag: '🇨🇭', offsetMs: 16 * hour },
  { name: 'Pierre', gender: 'male', flag: '🇫🇷', offsetMs: 19 * hour + 30 * minute },
  { name: 'Océane', gender: 'female', flag: '🇨🇦', offsetMs: 23 * hour },
];

export function getMc2SessionRegistrationAction(purchase) {
  return purchase?.gender === 'female' ? 's’est inscrite' : 's’est inscrit';
}

function getCalendarDateKey(timestampMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('fr-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(timestampMs));
}

export function formatMc2SessionRelativeTime(nowMs, referenceMs, timeZone = 'Europe/Paris') {
  const now = Number(nowMs);
  const reference = Number(referenceMs);
  if (!Number.isFinite(now) || !Number.isFinite(reference)) return '';

  const elapsedMs = Math.max(0, now - reference);
  if (elapsedMs < hour) {
    const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / minute));
    return `il y a ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'}`;
  }
  if (elapsedMs === hour) return 'il y a 1 heure';

  return getCalendarDateKey(now, timeZone) === getCalendarDateKey(reference, timeZone)
    ? 'aujourd’hui'
    : 'hier';
}

export function getMc2SessionSoldCount(nowMs, windowStartMs) {
  const now = Number(nowMs);
  const start = Number(windowStartMs);
  if (!Number.isFinite(now) || !Number.isFinite(start) || now < start) return 0;
  const elapsedMs = now - start;
  if (elapsedMs >= MC2_SESSION_OFFER_DURATION_MS) return MC2_SESSION_TOTAL_SEATS;
  return MC2_SESSION_PURCHASE_TIMELINE.filter((purchase) => purchase.offsetMs <= elapsedMs).length;
}

export function getMc2SessionSeatsLeft(nowMs, windowStartMs) {
  return Math.max(0, MC2_SESSION_TOTAL_SEATS - getMc2SessionSoldCount(nowMs, windowStartMs));
}

export function startMc2SessionScarcity(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
  const onSeatsLeft = typeof options.onSeatsLeft === 'function' ? options.onSeatsLeft : () => {};
  const onNotification = typeof options.onNotification === 'function' ? options.onNotification : () => {};
  const windowStartMs = Number(options.windowStartMs);
  let lastSoldCount = getMc2SessionSoldCount(now(), windowStartMs);
  let lastSeatPush = null;

  function tick({ emitNotification = true } = {}) {
    const nowMs = now();
    const soldCount = getMc2SessionSoldCount(nowMs, windowStartMs);
    const seatsLeft = Math.max(0, MC2_SESSION_TOTAL_SEATS - soldCount);

    if (seatsLeft !== lastSeatPush) {
      lastSeatPush = seatsLeft;
      onSeatsLeft(seatsLeft, soldCount);
    }

    if (emitNotification && isActive() && soldCount > lastSoldCount) {
      // Si l'onglet a dormi, on montre uniquement l'achat le plus récent au
      // réveil : pas de rafale artificielle de plusieurs notifications.
      const latestPurchase = MC2_SESSION_PURCHASE_TIMELINE[Math.min(
        soldCount,
        MC2_SESSION_PURCHASE_TIMELINE.length,
      ) - 1];
      if (latestPurchase) onNotification(latestPurchase);
    }
    lastSoldCount = soldCount;
  }

  let timer = null;

  function scheduleNextTick() {
    if (timer) clearTimeout(timer);
    const nowMs = now();
    const elapsedMs = Math.max(0, nowMs - windowStartMs);
    const nextPurchase = MC2_SESSION_PURCHASE_TIMELINE.find((purchase) => purchase.offsetMs > elapsedMs);
    // Le contrôle à 1 seconde garde le compteur réactif. À l'approche d'un
    // palier, on s'aligne directement sur son timestamp pour que la place et
    // la notification changent dans le même tick, sans dérive de setInterval.
    const untilNextPurchaseMs = nextPurchase ? nextPurchase.offsetMs - elapsedMs : 1000;
    const delayMs = Math.max(25, Math.min(1000, untilNextPurchaseMs));
    timer = setTimeout(() => {
      tick();
      scheduleNextTick();
    }, delayMs);
  }

  tick({ emitNotification: false });
  scheduleNextTick();

  return {
    recalc() {
      tick({ emitNotification: false });
      scheduleNextTick();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    debugSnapshot() {
      const nowMs = now();
      const soldCount = getMc2SessionSoldCount(nowMs, windowStartMs);
      return {
        nowMs,
        windowStartMs,
        soldCount,
        seatsLeft: Math.max(0, MC2_SESSION_TOTAL_SEATS - soldCount),
      };
    },
  };
}
