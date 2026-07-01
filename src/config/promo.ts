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
  name: "Demi-Million Instagram",
  emoji: "🎉",
  discount: 60,

  // Date/heure de fin (format: YYYY-MM-DDTHH:MM:SS, heure locale du visiteur)
  deadline: "2026-07-05T23:00:00",
  // Date/heure de début de la promo (utilisée pour la descente globale des places sur Manifest)
  start: "2026-07-01T17:33:00",

  // Textes affichés
  badgeText: "DEMI-MILLION INSTAGRAM -60%",
  bannerMessage: "sur toutes les formations",
  singleBannerMessage: "sur Manifest",

  // Thème couleur du banner (violet = rappel des couleurs Instagram)
  theme: "purple" as PromoTheme,

  // Prix promo par formation (modifiables sans toucher aux pages)
  formations: {
    manifest: {
      priceOriginal: 497,
      pricePromo: 199,
      installmentCount: 3,
      installmentPrice: 69,
      checkoutCode: "MIMIJUJU",
    },
    espritSubconscient: {
      priceOriginal: 297,
      pricePromo: 117,
      installmentCount: 3,
      installmentPrice: 45,
      checkoutCode: "FB1MILLION",
    },
    ssrLancement: {
      priceOriginal: 397,
      pricePromo: 157,
      installmentCount: 3,
      installmentPrice: 58,
      checkoutCode: "FB1MILLION",
    },
    neuroIa: {
      priceOriginal: 297,
      pricePromo: 117,
      installmentCount: 3,
      installmentPrice: 42,
      checkoutCode: "FB1MILLION",
    },
    systemeViral: {
      priceOriginal: 3997,
      pricePromo: 1597,
      installmentCount: 6,
      installmentPrice: 293,
      checkoutCode: "FB1MILLION",
      badgeText: "PROMO FB 1 MILLION -60%",
      banner: {
        label: "🏆 1 MILLION FACEBOOK",
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
