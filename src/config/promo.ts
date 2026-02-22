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
  name: "1 Million Facebook",

  // Emoji affiché à côté du nom
  emoji: "🏆",

  // Pourcentage de réduction affiché
  discount: 60,

  // Date/heure de fin de la promo (format: YYYY-MM-DDTHH:MM:SS)
  deadline: "2026-02-25T23:00:00",

  // Texte du badge sur les pages de vente (ex: "OFFRE ST-VALENTIN -50%")
  badgeText: "1 MILLION FACEBOOK -60%",

  // Texte court pour le banner (ex: "sur toutes les formations")
  bannerMessage: "sur toutes les formations",

  // Thème couleur du banner
  // Options : "red" | "purple" | "gold" | "green"
  //
  // red    → Rouge/rose (St-Valentin, urgence, flash)
  // purple → Violet/bleu (spirituel, premium, mystère)
  // gold   → Or/noir (luxe, exclusif, Black Friday)
  // green  → Vert/émeraude (nouveau départ, printemps, succès)
  theme: "gold" as "red" | "purple" | "gold" | "green",

  // Prix promo par formation (modifiables sans toucher aux pages)
  formations: {
    manifest: {
      priceOriginal: 497,    // Prix barré
      pricePromo: 197,       // Prix promo en une fois
      installmentCount: 3,   // Nombre de mensualités
      installmentPrice: 69,  // Prix par mensualité
    },
    espritSubconscient: {
      priceOriginal: 297,    // Prix barré
      pricePromo: 117,       // Prix promo en une fois
      installmentCount: 3,   // Nombre de mensualités
      installmentPrice: 45,  // Prix par mensualité
    },
    ssrLancement: {
      priceOriginal: 397,    // Prix barré
      pricePromo: 157,       // Prix promo en une fois
      installmentCount: 3,   // Nombre de mensualités
      installmentPrice: 58,  // Prix par mensualité
    },
  },
};
