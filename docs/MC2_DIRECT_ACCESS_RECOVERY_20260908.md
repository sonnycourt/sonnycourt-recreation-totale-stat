# MC2 — accès immédiat par email

## Périmètre

Correctif local préparé à partir de `main` / `5933a99`. Aucun déploiement,
envoi client ou changement Supabase effectué pendant sa préparation.

Le formulaire de récupération retrouve le token de l'inscription existante,
le vérifie, le mémorise et poursuit immédiatement la navigation. Il n'appelle
plus MailerSend. Ce fonctionnement reconnaît une inscription par son email ;
il ne vérifie pas que la personne contrôle cette boîte mail, comme le parcours
historique demandé par Sonny.

- `/mc2/session/`, `/mc2/confirmation/`, `/commencer/` : fermeture du formulaire
  partagé et reprise de l'initialisation avec le token retrouvé.
- `/offre/` : redirection vers la session avec le token retrouvé, comme pour
  les visiteurs dont le token était déjà mémorisé.
- Un token invalide dans l'ancienne URL ne masque plus le token récupéré dans
  l'initialisation de la session.
- Email inconnu : message d'erreur et nouvelle tentative possible.
- Base indisponible : erreur explicite, jamais de faux message « email envoyé ».
- Page restée ouverte avant la mise à jour : l'ancien formulaire reçoit une
  consigne de rechargement au lieu de prétendre qu'un email a été envoyé.

Les échéances, règles d'accès des pages, vidéos, achats, relances MailerLite/SMS
et le replay ne sont pas modifiés. Aucun token nouveau n'est créé ; aucune
progression ou date n'est réinitialisée. Les autres usages éventuels de
MailerSend dans le projet ne sont pas supprimés.

## Vérifications effectuées

- Tests serveur : validation, inscription trouvée/absente, erreur base/réseau,
  lecture seule Supabase, aucun appel au service email, réponse non cachable.
- Exécution du script réel du composant : token URL/mémorisé valide, token
  invalide remplacé, nouvelle tentative, stockage indisponible, promesse
  d'accès résolue et conservation du chemin/paramètres/ancre.
- Chromium isolé au format mobile : formulaire réel sur les quatre pages,
  email inconnu puis accès réussi, stockage et URL vérifiés. Toutes les
  requêtes sont simulées ; aucun prospect ni email réel utilisé.
- Build Astro : 306 pages générées avec succès.
- Tests existants validés : récupération offre, accès session, échéance offre,
  continuité offre, planification des emails, choix de reprise replay.

## Test préexistant hors correctif

`mc2-session-inline-checkout-smoke.mjs` attend exactement `<DealOffer />`,
alors que la page actuelle utilise des propriétés sur ce composant. L'échec
est reproduit à l'identique sur `main` / `5933a99` avant ce correctif ; ni
l'intégration du checkout ni ce test ne sont modifiés ici.

Le test d'accès session a été rendu compatible avec `let expiryMs` et
`const expiryMs` : la variable était déjà déclarée avec `let` dans `main`.
