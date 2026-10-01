import { snapshotMc2OfferScarcity } from './lib/mc2-offer-scarcity.mjs';

const MAX_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_NOW_MS = Date.UTC(2020, 0, 1);
const MAX_NOW_MS = Date.UTC(2100, 0, 1);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  try {
    const body = await req.json();
    const windowStartMs = finite(body?.windowStartMs);
    const windowEndMs = finite(body?.windowEndMs);
    const requestedNow = finite(body?.nowMs);
    const nowMs = requestedNow != null && requestedNow >= MIN_NOW_MS && requestedNow <= MAX_NOW_MS
      ? requestedNow
      : Date.now();
    if (windowStartMs == null || windowEndMs == null || windowEndMs <= windowStartMs) {
      return json(400, { error: 'Fenêtre d’offre invalide' });
    }
    if (windowEndMs - windowStartMs > MAX_WINDOW_MS) {
      return json(400, { error: 'Fenêtre d’offre invalide' });
    }
    const seenRaw = body?.seenSoldCount;
    const seenSoldCount = seenRaw == null ? null : finite(seenRaw);
    if (seenRaw != null && seenSoldCount == null) {
      return json(400, { error: 'Curseur invalide' });
    }
    const snapshot = snapshotMc2OfferScarcity({
      windowStartMs,
      windowEndMs,
      nowMs,
      seenSoldCount,
    });
    return json(200, {
      evaluatedNowMs: snapshot.evaluatedNowMs,
      remainingMs: snapshot.remainingMs,
      seatsLeft: snapshot.seatsLeft,
      soldCount: snapshot.soldCount,
      phase: snapshot.phase,
      totalSeats: snapshot.totalSeats,
      purchases: snapshot.purchases,
      nextChangeInMs: snapshot.nextChangeInMs,
      expired: snapshot.expired,
      soldOut: snapshot.soldOut,
    });
  } catch {
    return json(400, { error: 'Requête invalide' });
  }
};
