// ============================================
// CONFIGURATION PROMO HEBDOMADAIRE
// ============================================
// Pour changer la promo de la semaine :
// 1. Modifie les valeurs ci-dessous
// 2. Push sur main
// 3. Envoie tes emails avec les liens /formations-promo/ ou ?preview=promo
//
// Pour désactiver : mets active à false
// Pour préparer en avance : change tout mais garde active à false
// ============================================

export const promo = {
  // Est-ce que la promo est active ?
  active: true,

  // Nom affiché (ex: "St-Valentin", "Offre du Weekend", "Offre Spéciale")
  name: "St-Valentin",

  // Emoji affiché à côté du nom
  emoji: "❤️",

  // Pourcentage de réduction affiché
  discount: 50,

  // Date/heure de fin de la promo (format: YYYY-MM-DDTHH:MM:SS)
  deadline: "2026-02-15T23:59:00",

  // Texte du badge sur les pages de vente (ex: "OFFRE ST-VALENTIN -50%")
  badgeText: "OFFRE ST-VALENTIN -50%",

  // Texte court pour le banner (ex: "sur toutes les formations")
  bannerMessage: "sur toutes les formations",

  // Thème couleur du banner
  // Options : "red" | "purple" | "gold" | "green"
  //
  // red    → Rouge/rose (St-Valentin, urgence, flash)
  // purple → Violet/bleu (spirituel, premium, mystère)
  // gold   → Or/noir (luxe, exclusif, Black Friday)
  // green  → Vert/émeraude (nouveau départ, printemps, succès)
  theme: "red" as "red" | "purple" | "gold" | "green",
};
