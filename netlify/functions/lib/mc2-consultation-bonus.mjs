import {
  mc2LiveCtaAt,
  mc2OfferActivatedAt,
} from './mc2-offer-deadline.mjs';

export const MC2_CONSULTATION_BONUS_DURATION_MS = 24 * 60 * 60 * 1000;
export const MC2_BONUS_TAG_WITH_CONSULTATION = 'avec_consultation_sonny';
export const MC2_BONUS_TAG_WITHOUT_CONSULTATION = 'sans_consultation_sonny';

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

export function mc2ConsultationBonusCutoffAt({ registration, purchasedAt = new Date() } = {}) {
  const purchase = validDate(purchasedAt);
  if (!purchase) return null;

  const expiresAt = validDate(registration?.offer_expires_at);
  const activatedAt = expiresAt
    ? mc2OfferActivatedAt({ registration, expiresAt, now: purchase })
    : mc2LiveCtaAt(registration);

  return activatedAt
    ? new Date(activatedAt.getTime() + MC2_CONSULTATION_BONUS_DURATION_MS)
    : null;
}

export function mc2ConsultationBonusTag({ registration, purchasedAt = new Date() } = {}) {
  const purchase = validDate(purchasedAt);
  const cutoff = mc2ConsultationBonusCutoffAt({ registration, purchasedAt: purchase });

  // En l'absence exceptionnelle d'une ancre vérifiable, on n'attribue jamais
  // automatiquement le bonus limité. Le statut reste néanmoins explicite.
  return purchase && cutoff && purchase.getTime() < cutoff.getTime()
    ? MC2_BONUS_TAG_WITH_CONSULTATION
    : MC2_BONUS_TAG_WITHOUT_CONSULTATION;
}
