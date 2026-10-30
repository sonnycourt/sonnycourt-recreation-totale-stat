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
  // Un bonus déjà attribué reste acquis, y compris lors d'un nouvel événement
  // de paiement ou d'une relivraison de webhook.
  if (registration?.purchase_bonus_tag === MC2_BONUS_TAG_WITH_CONSULTATION
    || registration?.purchase_bonus_tag === MC2_BONUS_TAG_WITHOUT_CONSULTATION) {
    return registration.purchase_bonus_tag;
  }

  // Fenêtre d'origine : la consultation est offerte pendant les 24 heures
  // qui suivent l'apparition de l'offre. Les achats suivants restent sans.
  const purchase = validDate(purchasedAt);
  const cutoff = mc2ConsultationBonusCutoffAt({ registration, purchasedAt: purchase });

  // En l'absence exceptionnelle d'une ancre vérifiable, on n'attribue jamais
  // automatiquement le bonus limité. Le statut reste néanmoins explicite.
  return purchase && cutoff && purchase.getTime() < cutoff.getTime()
    ? MC2_BONUS_TAG_WITH_CONSULTATION
    : MC2_BONUS_TAG_WITHOUT_CONSULTATION;
}
