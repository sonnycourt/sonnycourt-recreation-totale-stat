# Formulaire gratuit restauré — 26 septembre 2026

Préparation locale uniquement, aucune publication.

Références : `MC2_META_OPTIN_ALIGNMENT.md` et version de la page avant
`7568125` (séparation prénom/email).

1. Prénom et email ensemble ; validation et éligibilité existantes, puis
   `saveStep1Lead()` immédiatement, sans attendre le téléphone.
2. Téléphone ; widget, normalisation et filtre pays existants conservés.
3. Case de présence obligatoire ; `submitRegistration()` seulement après
   validation, avec attente de la capture partielle pour éviter une course.

Routes API, attribution, identifiant de funnel, dates, token et branche de
vérification des anciens paiements inchangés. Aucun changement serveur pour
cette restauration. Meta importe toujours la même page que l'organique.

Le script historique `mc2-optin-four-steps-browser.mjs` teste désormais ces
trois étapes : toutes les API sont simulées, aucun email/SMS réel.

Attention : `mc2-registration-country-smoke.mjs` conserve une assertion
imposant une entrée payante (`entry_payment_required=true`, statut partiel
après téléphone). Cette attente ne correspond plus au retour gratuit déjà
préparé auparavant ; ce test ne doit pas être annoncé comme passant.
