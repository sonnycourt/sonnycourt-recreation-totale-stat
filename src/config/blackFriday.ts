import { inspira } from '../data/inspira.mjs';

// Échéance commune à toutes les pages, exprimée en heure de Zurich.
export const blackFriday = {
  start: '2026-11-23T00:00:00+01:00',
  end: '2026-12-01T00:00:00+01:00',
};

export const deltaBlackFriday = {
  referencePrice: inspira.referencePrice,
  price: 47,
  checkoutUrl: 'https://sonnycourt.spiffy.co/checkout/delta-vision-black-friday?locale=fr',
  standardCheckoutUrl: null,
  offerLabel: 'Offre Black Friday',
};
export function discountPercent({ referencePrice, price }: { referencePrice: number; price: number }) {
  return Math.round(100 * (referencePrice - price) / referencePrice);
}
