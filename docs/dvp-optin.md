# DVP — inscription avant présentation

Page : `/dvp/`. Fonction : `/.netlify/functions/dvp-register`.
Groupe MailerLite créé le 13 novembre 2026 : **Inscrits Delta Vision**, ID `204040026040829106`.
La fonction utilise la variable serveur existante `MAILERLITE_API_KEY`. Aucun secret côté navigateur.
Les groupes historiques du checkout restent inchangés. Aucune automation email créée ou activée.

Le bouton soumet prénom et email. Le popup se ferme uniquement après confirmation API.
Le lecteur DVP utilise directement le flux HLS Bunny de la même VSL, avec HLS natif sur Safari et hls.js ailleurs. Commandes propres : Play/Pause et volume. Aucun contrôle natif, aucune barre de progression ni commande plein écran/PiP/cast. Lecture inline, surface vidéo sans interaction directe, clic droit bloqué sur le lecteur, tentative de déplacement de lecture ramenée à la position atteinte. Les interfaces imposées par le navigateur ou l’OS ne constituent pas une protection DRM et ne peuvent pas être universellement garanties.

Le bouton commercial suit currentTime/duration et s’active à durée moins 60 secondes. La pause arrête donc le décompte. Après activation, le lien reste disponible.

Une lecture muette est amorcée pendant le geste de soumission ; après inscription confirmée, retour au début, son et lecture. Si autoplay est refusé, notre bouton Play reste accessible.

Les tests utilisent une API simulée : `node scripts/dvp-register-smoke.mjs`.
Ne pas inscrire de faux contact ni envoyer d’email de test sans accord explicite.
Validation navigateur effectuée en bureau et viewport 390×844 ; ce n’est pas un test matériel Safari iPhone.
Aucun déploiement production effectué.


## Accès personnel DVP

Migration `sql/dvp_access_v1.sql` exécutée par Sonny. Accès service_role uniquement.
Le token aléatoire est transporté dans le fragment `#dvp=…` et mémorisé localement pour retrouver la présentation. La réponse publique ne contient ni email ni prénom.
L’échéance serveur est de 24 heures dès l’inscription, sans renouvellement à la réinscription. Une échéance navigateur antérieure est conservée si elle est plus courte. La progression maximale et le déblocage du CTA sont enregistrés ; un rafraîchissement restaure le lecteur sans nouvel opt-in.
Sur la page de vente, seul un token explicitement présent dans le lien active cette échéance personnelle. Les liens internes conservent ce token. Une erreur de vérification n’ouvre jamais une nouvelle promotion. L’accès direct sans token conserve son fonctionnement navigateur antérieur (23 h 17 min 34 s).
Champs MailerLite préparés : `dvp_personal_url`, `dvp_offer_deadline`, `dvp_reminder_at` (échéance moins 2 h). Aucun email de rappel ni automatisation activé : message à valider avec Sonny.
Tests complémentaires : `dvp-access-sql-smoke.mjs`, `dvp-access-smoke.mjs`, `dvp-video-gate-smoke.mjs`, `delta-vision-urgency-smoke.mjs`.
