# MC2 DraftX — copie de travail isolée

Créée le 8 septembre 2026 depuis `origin/main` (`17f353a`).
Branche : `codex/mc2-draftx`.

## Ouvrir et modifier

```sh
npm run dev -- --config astro.draftx.config.mjs --host 127.0.0.1 --port 4341
```

Page : http://127.0.0.1:4341/mc2/draftx/

L’offre est visible par défaut au timing du CTA. Le bouton « + » en haut à
droite ouvre la simulation : avant CTA, apparition, évolution des places,
fin de vidéo, expiration, retardataire. Aucun email ni token n’est nécessaire.

- Page et lecteur : `src/pages/mc2/draftx.astro`.
- Texte, prix, garantie, bonus et présentation : `src/components/mc2/DealOfferDraftX.astro`.
- Formulaire de paiement **simulé** : `src/components/mc2/DraftXCheckout.astro`.
- Barrière de sécurité : `src/components/mc2/DraftXSandbox.astro`.
- Timings et compteurs : fichiers `mc2-draftx-*` dans `src/lib` et `src/data`.
- Images, témoignages JSON et dépendances restent réutilisés en lecture seule.

Les nouvelles conditions commerciales (12 × 197 € et garantie six mois / 50 %)
ne sont PAS encore appliquées. La copie reprend les textes et les deux plans
de paiement de la session d’origine.

## Isolation

La session, le replay, l’offre partagée, les fonctions Netlify, Supabase et les
configurations de production n’ont pas été modifiés. Aucun déploiement.

La copie conserve la logique visuelle du lecteur, du CTA, de l’offre, des
compteurs, des témoignages et des états de fin. Les services réels ne sont pas
dupliqués : l’accès est remplacé par un participant fictif, le checkout par un
formulaire local et les événements par une liste en mémoire.

- Aucun appel aux fonctions Netlify depuis le brouillon.
- Aucun chargement du Pixel, de Clarity, de GA ou de Spiffy.
- Aucun paiement, inscription, email, SMS ou événement CAPI.
- Les paramètres personnels de l’URL sont retirés ; le mode preview est forcé.
- Aucun accès au stockage du vrai funnel : les états sont conservés en mémoire.
- CSP dédiée : frames et soumissions de formulaires interdites, scripts externes bloqués.
- Les liens vers le funnel réel sont interceptés et signalés comme simulations.
- Les vidéos Bunny, polices et images restent chargées pour vérifier le rendu.
- `noindex`, `nofollow`, `noarchive` et `no-referrer`.

Ce brouillon ne valide donc ni un vrai paiement Spiffy, ni les automatismes
serveur : il sert à modifier l’expérience sans intervenir sur les prospects.

## Vérifications

```sh
node scripts/mc2-draftx-smoke.mjs
npm run build
```

Le test dédié vérifie : 11 fichiers de production identiques au point de
départ, les modules de timing/compteurs identiques dans leurs copies, le
chargement vidéo, le CTA, le sticky, les deux plans simulés, les témoignages,
les places à H+24/H+48, l’expiration, la fin de vidéo, le rendu mobile,
l’absence d’appels vers les services réels et la préservation du stockage.

Vérifications historiques passées : `mc2-timing-smoke`,
`mc2-session-scarcity-smoke`, `mc2-offer-continuity-smoke`,
`mc2-replay-resume-choice-smoke`.

Un test historique **préexistant** échoue :
`mc2-session-inline-checkout-smoke.mjs` attend exactement `<DealOffer />`,
alors que la session du commit source contient déjà
`<DealOffer checkoutEmbedMode="iframe" />`. Ni la session ni ce test n’ont
été modifiés dans cette tâche ; ce résultat n’est pas présenté comme un test passant.
