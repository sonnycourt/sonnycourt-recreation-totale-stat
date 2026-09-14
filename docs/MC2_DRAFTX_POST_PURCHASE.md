# DraftX — reprise du parcours après achat MC2

État au 14 septembre 2026 : préparation locale et brouillons Spiffy uniquement.
Aucun déploiement, achat réel, email/SMS test ou changement de schéma Supabase.

**Mise à jour :** publication autorisée ensuite le 14 septembre. Préparation
du déploiement en cours ; ne pas confondre cette autorisation avec une validation
bout en bout. Les commandes J0 journalisent désormais la version
`mc2-cgv-2026-09-v7` et son URL `/mc2/draftx/cgv/`. Aucun article juridique,
email client ou schéma n’a été ajouté dans cette préparation.

## Existant repris, sans nouveau parcours

Sources vérifiées dans Spiffy : checkouts MC2 40006 et 40007.
Ils utilisent deux actions déclenchées à l'achat :

- Circle : ajouter le tag `ES 2.0 (AVANCÉ)`.
- Circle : ajouter au groupe d'espaces `ESPRIT SUBCONSCIENT 2.0 - AVANCÉ`.

Le groupe historique affiche une médaille argent dans le résumé enregistré et
une médaille or dans le sélecteur actuel. La sélection existante du checkout
40007 a été vérifiée ; il ne s'agit pas d'un nouveau groupe créé pour DraftX.
Aucune automatisation au niveau produit sur ces deux anciens checkouts.

Leur retour historique `/es2-derniere-etape` renvoie les inscriptions MC2 vers
`/commencer/succes/?provider=spiffy`, puis vers `/masterclass/success/` après
enregistrement des coordonnées. La page réutilisée reste
`src/pages/commencer/succes.astro`, pas une copie DraftX.

## Brouillons Spiffy enregistrés — pas publiés

| Checkout public | Identifiant admin | Offre |
| --- | --- | --- |
| 38556364 | 40406 | J0 à 0 €, puis 12 × 197 €, début J+7 |
| 38556365 | 40422 | J0 à 0 €, puis 6 × 347 €, début J+7 |

Sur chacun : les deux actions Circle ci-dessus et retour personnalisé vers
`https://sonnycourt.com/commencer/succes/?provider=spiffy`.
Transmission des détails de commande et de contact activée dans le retour,
comme dans l'ancien parcours. Les prix, échéances, moyens de paiement et
l'habillage/CGV existants n'ont pas été modifiés pour cette tâche.

Après autorisation explicite de Sonny, le champ de compte préexistant
`mc2_token` (3340) a été ajouté aux deux brouillons (blocs 366531 / 366532).
Il est facultatif et masqué dans notre intégration, avec une règle CSS ciblée.
Spiffy indique nativement « Prefill this field using mc2_token in the URL ».
Aucun token réel ni aucune commande test n'ont été transmis pour le vérifier.
Les ajustements sont enregistrés mais restent non publiés.

## Liens personnels et états réels de DraftX

- `/mc2/draftx/?t=TOKEN` (ou `token=TOKEN`) utilise le composant existant
  `Mc2AccessGate`, les données MC2, les horaires et états déjà en place.
- Le token est prioritaire sur `preview=dev` ; les paramètres de simulation
  sont retirés d'un lien personnel. Sans token ni aperçu explicite, le même
  contrôle d'accès propose la récupération existante par email.
- `/mc2/draftx/?preview=dev` seul reste isolé : mémoire de démonstration,
  aucun token stocké repris, aucun tracking MC2 réel. Une visite de démonstration
  arrivée à expiration doit être rechargée pour remonter dans le temps.
- Seule la référence validée par le contrôle d'accès est explicitement passée
  aux deux checkouts. Elle reste liée à la commande si l'email est corrigé.
  Aucun coupon/prix ni autre paramètre arbitraire de l'URL n'est propagé.
- La popup suit la disponibilité de l'offre ; l'expiration ferme et détruit
  une iframe de paiement déjà ouverte.
- Le message natif Spiffy de retour est filtré par origine, iframe source et
  destination exacte `/commencer/succes/`. Le token est ajouté au retour.
  Ce message ne marque jamais lui-même l'achat comme confirmé.
- Le serveur Astro local relaie uniquement une liste explicite de fonctions
  MC2 vers les services existants. Il ne déploie PAS les modifications backend
  J0 préparées ici. Leur activation demande toujours un déploiement autorisé.
- Aucune URL publiée, page Session/Replays historique ou automatisation
  récurrente n'a été remplacée. Depuis la mise à jour W13B locale, DraftX possède
  `/mc2/draftx/replay/`, avec le même contrôle d’accès et la même offre DraftX.
  `mc2-replay-enter?variant=draftx` oriente uniquement cette variante ; les liens
  historiques restent inchangés. Ces adaptations backend doivent être déployées
  avant de valider le parcours avec un vrai token. Voir `mc2-draftx.md`.

## Adaptations locales

- `spiffy-purchase-webhook.js` : identifiants 40406/40422 reconnus ; seule la
  commande initiale `order:success` avec identifiant de commande active le
  nouveau parcours, et non une mensualité, une attente ou un échec.
- Montant initial 0 centime ; total contractuel 236 400 ou 208 200 centimes.
  Pas de substitution du prix de la mensualité au montant J0, y compris CAPI.
- Même mise à jour MC2 `purchased` / `paid` et arrêt des relances existantes.
  Ici `paid` est le statut historique de confirmation de commande, pas la
  preuve d'un encaissement positif à J0.
- L'email d'achat est conservé dans un événement de commande Spiffy du journal
  existant `mc2_funnel_events`, sans remplacer l'email d'opt-in. La clé unique
  de commande permet de traiter les répétitions du webhook.
- `mc2-spiffy-status.js` restitue l'email d'achat, le prénom et le téléphone,
  puis les coordonnées déjà enregistrées. Pour les nouveaux plans il exige
  aussi l'événement Spiffy enregistré, avec concordance de commande si fournie.
- La page existante affiche l'email en lecture seule et les autres champs
  modifiables. `mc2-billing-info.js` est réutilisé sans modification : il ne
  permet pas de changer l'email et enregistre les champs de facturation existants.
- L'aperçu local simule la finalisation sans requête d'enregistrement et sans
  redirection en production.

## Points non finalisés avant activation

1. Le code local et les réglages Spiffy sont préparés, pas publiés. La seule
   présence d'un token dans le lien local ne rend pas les modifications J0
   opérationnelles sur le backend de production actuel.
2. L'automatisation globale Spiffy « ES2.0 - (Ottokit --> MailerLite) » existe
   déjà sur l'événement Purchase. Elle a été inspectée en lecture seule et
   laissée intacte. OttoKit demande une connexion ; les filtres internes et
   la livraison effective aux fonctions MC2 ne sont donc pas vérifiés.
   Ne pas créer un second relais ou un second envoi pour compenser à l'aveugle.
3. La livraison réelle du webhook J0 à
   `/.netlify/functions/spiffy-purchase-webhook` n'a pas été démontrée par cette
   inspection. Les tests utilisent des charges utiles simulées. L'acceptation
   historique des webhooks sans en-têtes de signature est préexistante et
   inchangée ; ce n'est pas une validation de sécurité de ce comportement.
4. Si la production définit explicitement `SPIFFY_MC2_CHECKOUT_IDS`, vérifier
   qu'elle inclut 40406/40422 : cette variable remplace les valeurs par défaut.
5. Les règles historiques de cycle de paiement « Payment Plan » ne prouvent
   pas une couverture des événements « Subscription » des nouvelles offres.
   Leur adaptation éventuelle n'a pas été faite ici. Les actions Purchase
   Circle ont été reprises, sans réinventer la gestion des impayés.
6. Publication du site et des brouillons Spiffy seulement après accord. Aucun
   test réel avec achat ou message client sans autorisation explicite.

## Vérifications effectuées

Tests locaux à trafic simulé, tous passants :

```sh
node scripts/mc2-draftx-post-purchase-smoke.mjs
node scripts/mc2-spiffy-purchase-webhook-smoke.mjs
node scripts/mc2-spiffy-checkout-smoke.mjs
node scripts/mc2-spiffy-sms-cancellation-smoke.mjs
node scripts/mc2-draftx-checkout-steps-smoke.mjs
node scripts/mc2-draftx-spiffy-smoke.mjs
node scripts/mc2-draftx-access-smoke.mjs
```

La nouvelle suite couvre les deux montants J0, les doublons, les événements
à ignorer, le statut sans confirmation, l'email d'achat distinct, le refus
des rapprochements ambigus, le préremplissage et l'enregistrement des champs
modifiables. Aucun service réel appelé.

Aperçu navigateur vérifié sur
`http://127.0.0.1:4342/commencer/succes/?provider=spiffy&preview=dev` : email
verrouillé, prénom/téléphone préremplis, adresse saisissable et finalisation
en simulation uniquement. Le parcours réel bout en bout n'est pas certifié.

Contrôles navigateur supplémentaires : un token fictif invalide avec
`preview=dev` affiche bien la récupération d'accès (aucune donnée client),
la phase 2 conserve ses montants/libellés, l'expiration retire l'offre et
le CTA de fin de webinaire ouvre la popup. La suite VM couvre avant session,
direct, retard, offre déjà vue, acheteur, expiration et lien invalide ; la
suite checkout couvre aussi la fermeture à expiration et l'email corrigé.
