# MC2 DraftX — copie de travail isolée

Créée le 8 septembre 2026 depuis `origin/main` (`17f353a`).
Branche : `codex/mc2-draftx`.

## Publication autorisée — 14 septembre 2026

Sonny a autorisé la publication de DraftX, des nouvelles CGV et du raccordement
après achat, avant son vrai test et avant toute bascule des URL historiques.
La route `src/pages/mc2/draftx/cgv.astro` est désormais statique et incluse au
build ; le texte approuvé porte la version `mc2-cgv-2026-09-v7`. Le lien de la
garantie DraftX et l’habillage des deux nouveaux checkouts visent cette route.
`/cgv/`, `/mc2/session/` et `/mc2/replay/` restent inchangées.
Le webhook J0 conserve la version et l’URL des CGV dans l’événement existant,
sans nouvelle table ni nouvel email. Le texte des 18 articles n’a pas changé
pour cette préparation ; seule la présentation « projet local » a été retirée.
Les sections ci-dessous consignent aussi l’historique de la préparation.

## Ouvrir et modifier

```sh
npm run dev -- --config astro.draftx.config.mjs --host 127.0.0.1 --port 4342
```

Page de démonstration : http://127.0.0.1:4342/mc2/draftx/?preview=dev

Lien personnel : `http://127.0.0.1:4342/mc2/draftx/?t=TOKEN`.
Depuis le 14 septembre, ce lien utilise le vrai contrôle d'accès MC2 et les
états du participant. L'aperçu ne doit pas contenir de token personnel.

L’offre est visible par défaut au timing du CTA. Le bouton « + » en haut à
droite ouvre la simulation : avant CTA, apparition, évolution des places,
fin de vidéo, expiration, retardataire. Aucun email ni token n’est nécessaire.

- Page et lecteur : `src/pages/mc2/draftx.astro`.
- Replay isolé : `src/pages/mc2/draftx/replay.astro`.
- Texte, prix, garantie, bonus et présentation : `src/components/mc2/DealOfferDraftX.astro`.
- Popup et paiement Spiffy : `src/components/mc2/DraftXCheckout.astro`.
- Barrière de sécurité : `src/components/mc2/DraftXSandbox.astro`.
- Timings et compteurs : fichiers `mc2-draftx-*` dans `src/lib` et `src/data`.
- Images, témoignages JSON et dépendances restent réutilisés en lecture seule.

Le brouillon intègre désormais les modifications commerciales locales :
0 € aujourd’hui, premier versement à J+7, puis 6 × 347 € ou 12 × 197 €,
et garantie six mois / 50 %. La page reste locale ; les deux checkouts Spiffy sont réels.

### Vidéos W13B — 14 septembre 2026

| Version | Identifiant Bunny (bibliothèque 698588) | Apparition de l’offre | Durée HLS mesurée |
| --- | --- | --- | --- |
| Live | `c0135d6e-9cfe-4605-a90b-b2ea2d7d7961` | 1:34:50 (5690 s) | 7919,95 s |
| Replay | `e538dedd-26e0-4b69-9900-13a7ec8a37f8` | 1:14:50 (4490 s) | 6718,69 s |

Sources centralisées dans `src/lib/mc2-draftx-media.mjs`. Les deux manifestes
HLS sont accessibles ; le repli MP4 du replay répond également. La durée
canonique du live est arrondie à 7920 s. L’avance historique de 15 minutes
avant l’heure annoncée est conservée.

Le replay réutilise le lecteur et le contrôle d’accès existants, avec
`DealOfferDraftX` et la même popup/les deux mêmes checkouts. Démonstration :
`http://127.0.0.1:4342/mc2/draftx/replay/?preview=dev`.
Les liens personnels DraftX passent par
`/.netlify/functions/mc2-replay-enter?variant=draftx&t=TOKEN`, puis le code
d’accès existant. Le code replay est stocké sous une clé propre à DraftX.

L’ancien cockpit vidéo ne peut plus réinjecter W12 dans DraftX : la source
initiale est fixée et le polling ne retient que la variante `draftx`. Les
commandes opérateur historiques et les vidéos publiques restent inchangées.

Vérifié en navigateur, en démonstration sans achat : vidéos chargées avec les
nouvelles durées, offre masquée avant le CTA et affichée au CTA, popup replay
ouverte puis passage au choix 6/12 mois avec l’identité préremplie.
`mc2-draftx-video-smoke.mjs` vérifie aussi les seuils exacts et les redirections
des variantes avec des services simulés.

**Avant publication / vrai test :** les fonctions de variante restent locales,
le proxy Astro vise encore la production et ne les exécute pas. Les nouvelles
CGV sont volontairement exclues du build par `[localDocument].astro` ; il faudra
explicitement préparer leur route publiée et les liens avant déploiement.
Activer ensemble les adaptations J0 et les brouillons Spiffy documentés dans
`MC2_DRAFTX_POST_PURCHASE.md`. Les timings serveur partagés, relances et cockpit
restent historiques : leur alignement W13B doit être traité lors de l’activation
appropriée, sans changer les sessions actuelles par effet de bord. Aucune bascule
ni archive de `/mc2/session/` ou `/mc2/replay/` n’a été faite.

### Branchement Spiffy — 12 septembre 2026

- 12 × 197 € : `https://sonnycourt.spiffy.co/checkout/38556364` (admin 40406).
- 6 × 347 € : `https://sonnycourt.spiffy.co/checkout/38556365` (admin 40422).
- Champs natifs obligatoires : email et First Name (`name_first`), libellé Prénom.
- Nom de famille et bloc adresse retirés de ces deux formulaires uniquement.
- CGV natives obligatoires et bouton « Je confirme mon inscription ».
- PayPal désactivé sur ces deux checkouts uniquement ; logo PayPal retiré de DraftX. Dans l’intégration, logos Spiffy et mention « All payments are secured… » masqués ; case CGV d’origine Spiffy conservée, sans surcharge de son contrôle ni de sa coche. Les autres logos de la page sont conservés.
- Habillage du mode intégré : `spiffy/mc2-draftx-embedded.html`, enregistré et publié dans Custom Tracking Code des deux checkouts. Aucune modification de prix.
- `src/lib/mc2-draftx-spiffy.mjs` transmet prénom et email par les paramètres natifs Spiffy. Depuis l'autorisation du 14 septembre, la référence MC2 validée est également transmise en mode personnel. Aucune carte ne passe par le code du site ; aucun coupon arbitraire n'est repris.
- Coordonnées préremplies depuis le contexte de session, modifiables avant paiement. Le contexte est réel avec un lien personnel ; fictif uniquement en aperçu explicite.
- Le changement de plan recharge le bon checkout et réinitialise son consentement.

Vérification navigateur : identité reçue dans les deux formulaires, absence de nom de famille/adresse, bon plan, présentation dans la popup. Aucun numéro de carte saisi, aucune inscription réelle validée.

Correction CGV — 13 septembre 2026 : les surcharges `.custom-control*` ont été retirées de l’habillage et des deux Custom Tracking Code publiés. Elles remplaçaient le contrôle Spiffy et masquaient sa coche. Le clic sur le carré coche de nouveau les deux plans ; le clic sur le texte permet de décocher. Vérifié sur ordinateur et avec la page complète dans une fenêtre de rendu de 390 × 700 px, sans changer les styles mobiles, les prix ou la logique de paiement. Un test de non-régression interdit ces surcharges dans le fichier d’habillage.

Alignement du texte CGV : seul le paragraphe `[data-mc2-terms]` reçoit un padding de `5px 0 0 8px` pour centrer sa première ligne avec le carré et laisser un espace horizontal. Aucun changement de l’input, du label ni des pseudo-éléments natifs ; clic sur le carré et décochage par le texte revérifiés sur les deux checkouts après publication.

Alerte de validation en français : l’habillage traduit uniquement le message Spiffy « Make sure you've filled in all required fields correctly » en « Vérifie que tous les champs obligatoires sont correctement remplis. », avec le libellé de fermeture « Fermer ». Le texte de l’alerte native est conservé pour toute autre erreur ; aucune validation n’est contournée. Publication et reproduction de l’alerte confirmées sur les deux plans, carte vide et CGV non cochées, sans achat ni paiement.

Libellé CGV — 14 septembre 2026 : après accord explicite de Sonny, seul « et l’échéancier ci-dessus » a été remplacé par « et le récapitulatif ci-dessus » dans les Custom Tracking Code des checkouts 40406 / 38556364 et 40422 / 38556365, puis publié. La phrase « J’accepte les CGV et le récapitulatif ci-dessus. » et le lien inchangé vers `https://sonnycourt.com/cgv/` ont été vérifiés dans la popup DraftX pour les deux rythmes. Styles, case native, prix, échéances et CGV inchangés ; aucun paiement effectué. Les nouvelles CGV restent locales et non publiées.

Raccordement après achat préparé le 14 septembre 2026 : voir [MC2_DRAFTX_POST_PURCHASE.md](MC2_DRAFTX_POST_PURCHASE.md). Les fonctions locales reconnaissent 40406/40422 ; les deux actions Circle, la page de retour et le champ natif MC2 ont été préparés dans les brouillons Spiffy. Token autorisé et raccordé, y compris si l'email change. Rien publié : le relais global existant reste inchangé et la chaîne réelle complète reste à valider après activation.

### Formulaire progressif — 11 septembre 2026

1. Prénom et email uniquement, avec validation avant de continuer.
2. Choix et confirmation du rythme de versement, en conservant les deux plans
   du dernier brouillon (12 fois présélectionné).
3. Rappel « 0 € aujourd’hui », échéancier correspondant, carte sécurisée et CGV Spiffy.
   Le cadran Garantie Manifestation est désormais placé après le bloc Spiffy,
   uniquement en phase 3. L’image des packs et son récapitulatif ont été retirés.

Le retour conserve la saisie et le plan. Un changement de plan demande à
nouveau de cocher les CGV. La logique est dans
`src/lib/mc2-draftx-checkout.mjs`. L’étape carte ouvre désormais un vrai checkout dans une iframe autorisée.
Les coordonnées sont transmises à Spiffy à cette étape ; elles ne sont pas persistées par DraftX.
La case d’acceptation renvoie vers les CGV dans un nouvel onglet.

Un bouton « Je commence à 0 € aujourd’hui » remplace le formulaire dans la page.
Il ouvre les trois étapes dans un dialogue natif centré, de hauteur adaptative, avec
fond assombri et page arrière bloquée. Les autres CTA d’inscription ouvrent cette
même popup. Fermeture par croix, Échap (natif) ou clic sur le fond ; réouverture
à l’étape conservée, sans perdre la saisie. Les étapes inactives restent cachées,
désactivées et inertes. La hauteur suit le contenu de l’étape active et le contenu
glisse entre les étapes. La hauteur maximale reste limitée à l’écran ; les longues
étapes défilent à l’intérieur de la popup. Aucun scroll de page n’est lancé.

Validation sans navigateur :

```sh
node scripts/mc2-draftx-checkout-steps-smoke.mjs
node scripts/mc2-draftx-spiffy-smoke.mjs
npm run build
```

## Isolation

La session, le replay et l'offre partagée de production sont inchangés.
Les adaptations des fonctions Netlify sont locales, sans déploiement ni
modification de schéma Supabase. Le proxy de développement est limité à
`astro.draftx.config.mjs` et aux fonctions MC2 explicitement autorisées.

La copie conserve la logique visuelle du lecteur, du CTA, de l’offre, des
compteurs, des témoignages et des états de fin. Les services réels ne sont pas
dupliqués : en lien personnel le contrôle MC2 existant est réutilisé ; en
`?preview=dev` seul, le participant et les événements restent fictifs.

- Aucun appel aux fonctions Netlify depuis l'aperçu explicite sans token.
- Aucun chargement du Pixel, de Clarity ou de GA par la page hôte.
- L'aperçu ne crée pas d'inscription MC2 et ne déclenche pas de tracking réel. En mode personnel, les événements/presences MC2 existants reprennent leur fonctionnement habituel.
- Un token URL a priorité sur le mode aperçu ; les paramètres de simulation sont alors retirés.
- En aperçu uniquement : stockage en mémoire et liens vers le funnel signalés comme simulations.
- CSP dédiée : frames de même origine et `https://sonnycourt.spiffy.co` autorisées ; soumissions natives de la page hôte et scripts externes bloqués.
- Les vidéos Bunny, polices et images restent chargées pour vérifier le rendu.
- `noindex`, `nofollow`, `noarchive` et `no-referrer`.

Le bouton final Spiffy est réel : ne pas le valider avec une carte réelle pour un test. Cette tâche n’a validé ni transaction, ni automatismes serveur.

## Vérifications

```sh
node scripts/mc2-draftx-checkout-steps-smoke.mjs
node scripts/mc2-draftx-spiffy-smoke.mjs
npm run build
```

Le test historique `mc2-draftx-smoke.mjs` vérifiait : 11 fichiers de production identiques au point de
départ, les modules de compteurs identiques dans leurs copies, le
chargement vidéo, le CTA, le sticky, les deux plans simulés, les témoignages,
les places à H+24/H+48, l’expiration, la fin de vidéo, le rendu mobile,
l’absence d’appels vers les services réels et la préservation du stockage. Ses vérifications de carte simulée ont été remplacées par la vérification du bon iframe ; il ne clique jamais le bouton final Spiffy. Les nouveaux timings W13B sont volontairement distincts et couverts par `mc2-draftx-video-smoke.mjs`. La vérification navigateur W13B du 14 septembre a été faite via CUA, sans exécuter ce script Puppeteer historique.

Vérifications historiques passées : `mc2-timing-smoke`,
`mc2-session-scarcity-smoke`, `mc2-offer-continuity-smoke`,
`mc2-replay-resume-choice-smoke`.

Un test historique **préexistant** échoue :
`mc2-session-inline-checkout-smoke.mjs` attend exactement `<DealOffer />`,
alors que la session du commit source contient déjà
`<DealOffer checkoutEmbedMode="iframe" />`. Ni la session ni ce test n’ont
été modifiés dans cette tâche ; ce résultat n’est pas présenté comme un test passant.
