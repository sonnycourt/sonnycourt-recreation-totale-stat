export const MC2_SESSION_TOTAL_SEATS = 15;
export const MC2_SESSION_OFFER_DURATION_MS = 24 * 60 * 60 * 1000;
export const MC2_SESSION_HALF_WINDOW_MS = 12 * 60 * 60 * 1000;

const minute = 60 * 1000;
const hour = 60 * minute;

// 10 places partent pendant les 12 premières heures, puis les 5 dernières
// restent disponibles pendant la seconde moitié de la fenêtre. La dernière
// place reste achetable jusqu'à l'expiration exacte du countdown.
export const MC2_SESSION_PURCHASE_TIMELINE = [
  { name: 'Sophie', flag: '🇧🇪', offsetMs: 5 * minute },
  { name: 'Nicolas', flag: '🇨🇭', offsetMs: 22 * minute },
  { name: 'Thomas', flag: '🇫🇷', offsetMs: 47 * minute },
  { name: 'Gabrielle', flag: '🇨🇦', offsetMs: 1 * hour + 25 * minute },
  { name: 'Charlotte', flag: '🇧🇪', offsetMs: 2 * hour + 15 * minute },
  { name: 'Vanessa', flag: '🇨🇭', offsetMs: 3 * hour + 25 * minute },
  { name: 'Julien', flag: '🇫🇷', offsetMs: 4 * hour + 55 * minute },
  { name: 'Manon', flag: '🇫🇷', offsetMs: 6 * hour + 40 * minute },
  { name: 'Arnaud', flag: '🇧🇪', offsetMs: 9 * hour + 5 * minute },
  { name: 'Clara', flag: '🇩🇪', offsetMs: 11 * hour + 50 * minute },
  { name: 'Hugo', flag: '🇧🇪', offsetMs: 14 * hour + 24 * minute },
  { name: 'Margot', flag: '🇨🇭', offsetMs: 16 * hour + 48 * minute },
  { name: 'Pierre', flag: '🇫🇷', offsetMs: 19 * hour + 12 * minute },
  { name: 'Oceane', flag: '🇨🇦', offsetMs: 21 * hour + 36 * minute },
];

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

  tick({ emitNotification: false });
  const timer = setInterval(() => tick(), 1000);

  return {
    recalc() {
      tick({ emitNotification: false });
    },
    stop() {
      clearInterval(timer);
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
