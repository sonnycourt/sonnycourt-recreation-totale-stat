// Configuration unique de la reconquête. Aucun effet sur MC2 Session / Replay.
// Exemple proposé, pas encore une campagne publiée. Heures de Paris/Zurich.
// Dimanche 18 h → fin du mardi à minuit = 54 heures.
// Le paiement est encore un aperçu local : published ne suffit PAS à l'activer.
// Valider d'abord un retour après achat pour les anciens inscrits ET les MC2,
// sans dépendre d'un ancien jeton expiré ni changer le funnel existant.
export const specialOffer = Object.freeze({
  campaignId: 'es2-reconquete-2026-10-04',
  published: false,
  startsAt: '2026-10-04T18:00:00+02:00',
  endsAt: '2026-10-07T00:00:00+02:00',
  timeZone: 'Europe/Zurich',
  capacity: 5,
  // Départ affiché. Le compteur descend jusqu'à 0 par paliers égaux
  // entre startsAt et endsAt (mardi 6 octobre à minuit).
  // null affiche seulement la capacité, sans décompte.
  remainingSeats: 4,
  videoLibraryId: '698588',
  videoId: 'ec89b935-4508-47e5-9b58-b85c0c07db50',
  videoTemporary: false,
});
