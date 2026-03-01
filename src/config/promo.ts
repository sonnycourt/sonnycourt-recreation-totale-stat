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

export type PromoTheme = "red" | "purple" | "gold" | "green";
export type PromoMode = "all" | "single";
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

  // Portée de la promo : "all" (toutes) ou "single" (une seule)
  mode: "single" as PromoMode,
  targetFormation: "manifest" as PromoFormationKey,

  // Nom affiché
  name: "Mimi & Juju",
  emoji: "🤍",
  discount: 60,

  // Date/heure de fin (format: YYYY-MM-DDTHH:MM:SS)
  deadline: "2026-03-04T23:00:00",
  // Date/heure de début de la promo (utilisée pour la descente globale des places sur Manifest)
  start: "2026-03-01T00:00:00",

  // Textes affichés
  badgeText: "EN LEUR MÉMOIRE -60%",
  bannerMessage: "sur toutes les formations",
  singleBannerMessage: "sur Manifest",

  // Thème couleur du banner
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
