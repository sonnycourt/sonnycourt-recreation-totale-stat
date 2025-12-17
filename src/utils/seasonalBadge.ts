// Mapping des badges par mois
const badges: Record<number, { icon: string; text: string }> = {
  1: { icon: "rocket", text: "OFFRE NEW YEAR -50%" },        // Janvier
  2: { icon: "snowflake", text: "OFFRE HIVER -50%" },        // Février
  3: { icon: "sprout", text: "OFFRE PRINTEMPS -50%" },       // Mars
  4: { icon: "egg", text: "OFFRE PÂQUES -50%" },             // Avril
  5: { icon: "bicep", text: "OFFRE FÊTE DU TRAVAIL -50%" },  // Mai
  6: { icon: "sun", text: "OFFRE ÉTÉ -50%" },                // Juin
  7: { icon: "cake", text: "OFFRE ANNI SONNY -50%" },        // Juillet
  8: { icon: "sunset", text: "OFFRE FIN D'ÉTÉ -50%" },       // Août
  9: { icon: "book", text: "OFFRE RENTRÉE -50%" },           // Septembre
  10: { icon: "leaf", text: "OFFRE AUTOMNE -50%" },          // Octobre
  11: { icon: "zap", text: "BLACK FRIDAY -50%" },            // Novembre
  12: { icon: "gift", text: "OFFRE FIN D'ANNÉE -50%" }       // Décembre
};

// Fonction pour obtenir le badge du mois actuel
export function getSeasonalBadge(): { icon: string; text: string } {
  const currentMonth = new Date().getMonth() + 1; // getMonth() retourne 0-11, donc +1 pour 1-12
  return badges[currentMonth] || badges[1]; // Fallback sur janvier si erreur
}

// Fonction pour obtenir le SVG de l'icône
export function getSeasonalIconSVG(iconName: string): string {
  const icons: Record<string, string> = {
    rocket: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
    snowflake: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="17" y1="5" x2="7" y2="19"/><line x1="7" y1="5" x2="17" y2="19"/><line x1="19" y1="12" x2="5" y2="12"/><line x1="16.5" y1="7.5" x2="7.5" y2="16.5"/><line x1="7.5" y1="7.5" x2="16.5" y2="16.5"/></svg>`,
    sprout: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-7"/><path d="M9 12l.5-1"/><path d="M14 12l.5-1"/><path d="M9.5 5C9.2 3.2 9.5 2 11 2c1.5 0 1.8 1.2 1.5 3"/><path d="M14.5 5C14.2 3.2 14.5 2 16 2c1.5 0 1.8 1.2 1.5 3"/><path d="M12 7v10"/></svg>`,
    egg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c6.23-.05 7.87-5.57 7.5-10-.36-4.34-3.95-9.96-7.5-10-3.55.04-7.14 5.66-7.5 10-.37 4.43 1.27 9.95 7.5 10z"/></svg>`,
    bicep: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5z" fill="none"/><path d="M9.5 6V4a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v2"/><path d="M6.5 9h11"/><path d="M9.5 12h5"/></svg>`,
    sun: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
    cake: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2v10"/><path d="M2 12c0 3.3 2.7 6 6 6h8c3.3 0 6-2.7 6-6"/><path d="M6 18h12"/><path d="M8 8h8"/></svg>`,
    sunset: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="m2 18h2"/><path d="m20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="m22 22H2"/><path d="m16 6a4 4 0 0 0-8 0"/><path d="m12 18a4 4 0 0 0 0-8"/></svg>`,
    book: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
    leaf: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 11"/></svg>`,
    zap: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    gift: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>`
  };

  return icons[iconName] || icons.rocket; // Fallback sur rocket si icône non trouvée
}

