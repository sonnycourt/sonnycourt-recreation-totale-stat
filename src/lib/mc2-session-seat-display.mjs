// Affichage des places sur /mc2/session/ et /mc2/replay/.
// Le serveur continue de compter 37 achats jusqu'à l'échéance. Ces deux pages
// les réaffichent de 20 à 0, sans avancer la fermeture de l'offre.

export const MC2_SESSION_DISPLAY_INITIAL_SEATS = 20;
export const MC2_SESSION_DISPLAY_TIMELINE_PURCHASES = 37;

export function mc2SessionDisplaySeats(soldCount) {
  const sold = Math.max(0, Math.floor(Number(soldCount) || 0));
  if (sold >= MC2_SESSION_DISPLAY_TIMELINE_PURCHASES) return 0;
  if (sold <= 0) return MC2_SESSION_DISPLAY_INITIAL_SEATS;
  const consumed = Math.min(
    MC2_SESSION_DISPLAY_INITIAL_SEATS - 1,
    Math.ceil(
      sold * (MC2_SESSION_DISPLAY_INITIAL_SEATS - 1)
      / (MC2_SESSION_DISPLAY_TIMELINE_PURCHASES - 1),
    ),
  );
  return MC2_SESSION_DISPLAY_INITIAL_SEATS - consumed;
}
