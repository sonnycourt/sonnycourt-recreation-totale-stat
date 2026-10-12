# Delta Vision — checkout Spiffy

- Checkout 41037, produit 12015, paiement unique 47 EUR.
- URL : https://sonnycourt.spiffy.co/checkout/delta-vision?locale=fr
- Le fichier `delta-vision-payment-embed.html` remplace l’ancien parcours dans Settings → Custom Tracking Code de **ce checkout uniquement**. Publié le 12 octobre 2026 après confirmation explicite de Sonny ; site de production non publié.
- Contact natif : email. Collect Names désactivé ; champ natif First Name (`name_first`) ajouté comme Text Input obligatoire, bloc 371787.
- Téléphone natif (`phone_number`) obligatoire, bloc 371786.
- Ancien bloc adresse de facturation retiré du nouveau checkout ; aucune modification des checkouts ES2.
- Sections : contact 334079, téléphone 334084, paiement 334081, bouton d’achat 334082.
- CGV natives obligatoires : bloc 371788, option 0, lien `/cgv/`. Bouton natif « Accéder à Delta Vision — 47 € ».
- La navigation ne soumet aucun paiement et ne stocke aucune donnée de carte. Spiffy conserve le paiement, ses champs sécurisés, les CGV et la validation finale. Aucun produit ou réglage créé directement dans Stripe.
- Les automatismes de livraison du cours ne sont pas configurés par cette intégration. Aucun nouvel email/SMS n’a été activé.

## Interface maison

`SpiffyCheckout.astro` + `delta-vision-checkout.mjs` : dialogue natif, prénom avant email, puis téléphone international, puis paiement. Aucune annonce des étapes suivantes. Image jungle et lianes à droite, masquées sur mobile. Aucun stockage navigateur des coordonnées.

Téléphone : drapeaux et indicatifs sélectionnables ; pays présélectionné via `delta-vision-country` et la géolocalisation IP Netlify (pays seulement, aucune IP renvoyée). Repli France en cas d’échec. Une sélection ou saisie manuelle n’est jamais remplacée par une réponse tardive. Validation libphonenumber et normalisation E.164 avant enregistrement.

Le cadre Spiffy est créé seulement au paiement. Il reste masqué tant que Spiffy n’a pas confirmé le préremplissage et les dimensions. Les messages sont filtrés par origine ET fenêtre source. Les champs natifs d’identité sont masqués seulement après préremplissage ; les champs de carte ne sont jamais déplacés ni lus. Le checkout complet reste accessible par le lien HTML si JavaScript ne fonctionne pas.

Correctif du 12 octobre, 19 h 26 Zurich : les coordonnées natives sont resynchronisées via leurs événements input/change lorsqu’elles ne correspondent pas aux données du popup, y compris un téléphone déjà rempli. L’ancien garde-fou pouvait attendre indéfiniment une correspondance. Vérification sur la session réelle initialement bloquée de la preview : signal ready reçu, cadre visible, champs carte/CGV/bouton présents. Aucun paiement soumis. `node scripts/delta-vision-bridge-smoke.mjs` couvre identité fraîche et anciennes coordonnées restaurées. Les diagnostics console ne contiennent que des états booléens, aucune coordonnée.

## MailerLite

- Groupes créés : `DeltaVision Inscription` et `DeltaVision Acheteurs`, sans automation email.
- Fonction `delta-vision-register` : POST même origine, données validées, limitation 12 requêtes/minute/IP. Prénom/email enregistrés avant passage au téléphone ; téléphone ajouté ensuite.
- API MailerLite POST additive : ni écrasement des groupes existants, ni changement du statut de consentement, ni réabonnement.
- Fonction `delta-vision-purchase` : webhook privé authentifié, limité au checkout 41037, ajout au groupe acheteurs. Ne jamais appeler depuis le navigateur. Les doublons sont des upserts idempotents.
- Abandons = membres Inscription qui ne sont pas membres Acheteurs. Pas d’envoi automatique de relance.
- Variables fonctions Netlify : `MAILERLITE_GROUP_DELTA_VISION_REGISTRATIONS`, `MAILERLITE_GROUP_DELTA_VISION_BUYERS`, `DELTA_VISION_SPIFFY_WEBHOOK_TOKEN`, clé MailerLite existante. Ne pas afficher le secret.
- Le webhook Purchase a été publié avec le checkout. Le classement des acheteurs est configuré ; aucun achat réel n’a été effectué pour tester cet automatisme.
- Le webhook peut pointer vers la preview immuable pour tester cette intégration isolée. Après publication du site autorisée séparément, remplacer sa base par `https://sonnycourt.com` sans changer son chemin ni son secret.

## Vérifications

`node scripts/delta-vision-house-checkout-smoke.mjs` : validation, préremplissage URL, messages sécurisés, erreurs API, authentification webhook, filtrage checkout, groupes additifs. Tests backend avec fetch simulé, aucune écriture de contact.

Build 322 pages et contrôle des routes critiques réussis. Test local du dialogue desktop/mobile, champs requis, téléphone invalide et étapes avec endpoint d’inscription simulé. Après publication Spiffy : champs carte natifs, CGV et bouton 47 € visibles, sans coordonnées ni résumé Spiffy en double. Aucun paiement ni email test.

Preview : https://6acd13fb8eb36927d17853b1--sonnycourt-recreation-totale.netlify.app/delta-vision/

Le webhook Purchase reste dirigé vers la preview précédente immuable `6acd0f4acc717044a14c1bc8` (même fonction authentifiée), jusqu’à l’autorisation distincte de mise en production du site.

Pour revenir au formulaire natif complet, retirer uniquement le contenu de Custom Tracking Code de ce checkout puis publier dans Spiffy. Les champs et le montant restent configurés dans l’éditeur Spiffy.
