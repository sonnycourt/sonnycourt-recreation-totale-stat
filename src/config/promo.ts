// ============================================
// CONFIGURATION PROMO HEBDOMADAIRE
// ============================================
// Pour changer la promo de la semaine :
// 1) Active/désactive la promo
// 2) Choisis la portée :
//    - mode: "all"    => promo sur toutes les formations
//    - mode: "single" => promo uniquement sur targetFormation
// 3) Ajuste les prix/codes checkout dans formations
// ============================================

export type PromoTheme = "red" | "purple" | "gold" | "green" | "summer";
export type PromoMode = "all" | "single" | "list";
export type PromoFormationKey =
  | "manifest"
  | "espritSubconscient"
  | "ssrLancement"
  | "neuroIa"
  | "systemeViral";

export const promoThemeStyles: Record<PromoTheme, {
  bg: string;
  accent: string;
  btn: string;
  btnText: string;
}> = {
  red: {
    bg: "linear-gradient(105deg, #8b0e3a 0%, #b31950 40%, #c6284a 100%)",
    accent: "linear-gradient(100deg, #ffffff 0%, #ffd5e0 70%)",
    btn: "#ffd166",
    btnText: "#7c0a2a",
  },
  purple: {
    bg: "linear-gradient(105deg, #2d1b69 0%, #5b2d8e 40%, #7c3aed 100%)",
    accent: "linear-gradient(100deg, #ffffff 0%, #d8b4fe 70%)",
    btn: "linear-gradient(135deg, #ffcf40 0%, #ff8c1a 100%)",
    btnText: "#3a1500",
  },
  gold: {
    bg: "linear-gradient(105deg, #1a1a1a 0%, #2d2306 40%, #44370a 100%)",
    accent: "linear-gradient(100deg, #ffd700 0%, #ffec80 70%)",
    btn: "#ffd700",
    btnText: "#1a1a1a",
  },
  green: {
    bg: "linear-gradient(180deg, #0b3d2e 0%, #166534 45%, #34a853 100%)",
    accent: "linear-gradient(100deg, #ecfdf5 0%, #bbf7d0 70%)",
    btn: "#dcfce7",
    btnText: "#14532d",
  },
  summer: {
    bg: "linear-gradient(180deg, #0b3d2e 0%, #166534 45%, #34a853 100%)",
    accent: "linear-gradient(100deg, #ecfdf5 0%, #bbf7d0 70%)",
    btn: "#dcfce7",
    btnText: "#14532d",
  },
};

const formationLabels: Record<PromoFormationKey, string> = {
  manifest: "Manifest",
  espritSubconscient: "Esprit Subconscient",
  ssrLancement: "Système Souhaits Réalisés",
  neuroIa: "Neuro IA",
  systemeViral: "Système Viral",
};

export const promo = {
  // Active/désactive toute la mécanique promo
  active: true,

  // Portée de la promo : "all" (toutes) | "single" (une seule) | "list" (sous-ensemble)
  mode: "list" as PromoMode,
  targetFormation: "manifest" as PromoFormationKey,
  // Utilisé uniquement quand mode === "list" : promo sur ces formations UNIQUEMENT.
  // NB : espritSubconscient = la FORMATION Esprit Subconscient (page /esprit-subconscient/).
  // Le FUNNEL "Esprit Subconscient 2.0" (es-video / es-direct-checkout) est indépendant
  // de ce fichier et n'est donc PAS touché par la promo.
  targetFormations: [
    "manifest",
    "neuroIa",
    "ssrLancement",
    "espritSubconscient",
    "systemeViral",
  ] as PromoFormationKey[],

  // Nom affiché
  name: "La Rentrée",
  emoji: "🚀",
  discount: 60,
  packDiscount: 70,

  // Date/heure de fin (format: YYYY-MM-DDTHH:MM:SS, heure locale du visiteur)
  deadline: "2026-09-01T23:59:00",
  // Date/heure de début de la promo (utilisée pour la descente globale des places sur Manifest)
  start: "2026-08-28T17:00:00",

  // Textes affichés
  badgeText: "OFFRE DE LA RENTRÉE -60%",
  packBadgeText: "OFFRE DE LA RENTRÉE -70%",
  bannerMessage: "pour attaquer la rentrée avec une longueur d'avance",
  singleBannerMessage: "sur Manifest pour démarrer la rentrée du bon pied",

  // Rouge = énergie, urgence et dernière ligne droite de la rentrée
  theme: "red" as PromoTheme,

  // Prix promo par formation (modifiables sans toucher aux pages)
  formations: {
    manifest: {
      priceOriginal: 597,
      pricePromo: "238,80",
      installmentCount: 3,
      installmentPrice: "84,12",
      checkoutCode: "RENTREE60",
    },
    espritSubconscient: {
      priceOriginal: 397,
      pricePromo: "158,80",
      installmentCount: 3,
      installmentPrice: "61,58",
      checkoutCode: "RENTREE60",
    },
    ssrLancement: {
      priceOriginal: 497,
      pricePromo: "198,80",
      installmentCount: 3,
      installmentPrice: "73,67",
      checkoutCode: "RENTREE60",
    },
    neuroIa: {
      priceOriginal: 397,
      pricePromo: "158,80",
      installmentCount: 3,
      installmentPrice: "57,26",
      checkoutCode: "RENTREE60",
    },
    systemeViral: {
      priceOriginal: 3997,
      pricePromo: 1597,
      installmentCount: 6,
      installmentPrice: 293,
      checkoutCode: "FB1MILLION",
      badgeText: "OFFRE DE LA RENTRÉE -60%",
      banner: {
        label: "🚀 LA RENTRÉE",
        highlight: "-60% sur la formation complète",
        btnText: "Rejoindre Système Viral →",
      },
    },
  },
};

export function isPromoActiveFor(formation: PromoFormationKey): boolean {
  if (!promo.active) return false;
  if (promo.mode === "all") return true;
  if (promo.mode === "list") return promo.targetFormations.includes(formation);
  return promo.targetFormation === formation;
}

export function getPromoBannerMessage(): string {
  if (promo.mode === "single") {
    return promo.singleBannerMessage || `sur ${formationLabels[promo.targetFormation]}`;
  }
  return promo.bannerMessage;
}

export function getPromoLabel(): string {
  return `${promo.emoji} ${promo.name}`;
}

export function getPromoCheckoutCode(formation: PromoFormationKey): string {
  if (!isPromoActiveFor(formation)) return "";
  return promo.formations[formation].checkoutCode || "";
}
