# Pay — périmètre Spiffy interne

Audit fonctionnel réalisé le 8 août 2026 sur le compte Spiffy de Sonny Court,
en lecture seule.

## Périmètre retenu

- Tableau de bord combiné Stripe + PayPal : ventes, remboursements, commandes,
  encaissements attendus, échéances et impayés.
- Checkouts : liste, recherche, statut, lien et statistiques. Les checkouts
  sont codés dans le site puis reliés à leurs objets Stripe/PayPal ; Pay n'est
  pas un constructeur drag-and-drop.
- Catalogue : lecture des produits et prix uniques/récurrents. Les brouillons
  déjà créés restent disponibles mais ne font pas partie du parcours principal.
- Ventes : commandes, clients, paiements, abonnements et plans de paiement.
- Remises : montant fixe ou pourcentage, date d'expiration, usage unique par
  client, application aux paiements uniques ou récurrents.
- Rapports : ventes par produit, valeur client, performance des checkouts,
  performance des plans, projection de trésorerie, paiements échoués et taxes
  sur les ventes par pays et passerelle.
- Exports CSV filtrés.
- Fiches commande, client et plan avec historique et notes. Le dossier client
  rapproche les identités fournisseur et vérifie à la demande si Stripe expose
  un moyen de paiement tokenisé réutilisable ; seuls la marque, les quatre
  derniers chiffres et l'expiration sont affichés.
- Paiements échoués et brouillon de règle de relance email, désactivé par
  défaut jusqu'à l'autorisation du stockage Supabase et du moteur d'envoi.

L'affiliation, les parrainages, l'interface MCP de Spiffy et l'éditeur visuel de
checkout sont hors MVP.

## Volumétrie Spiffy observée

- 1 841 commandes ;
- 1 557 clients ;
- 552 plans de paiement ;
- 385 paiements ;
- 23 checkouts.

Ces nombres sont des repères de réconciliation et ne doivent jamais servir de
clé ou de source de vérité.

## Sources de vérité

1. Stripe reste la source de vérité des objets et états Stripe.
2. PayPal reste la source de vérité des objets et états PayPal.
3. Supabase conserve une projection normalisée, interrogeable et historisée.
4. L'export Spiffy sert au rattrapage historique et à préserver les identifiants
   et données métier que Stripe ou PayPal ne connaissent pas.

Les ressources Stripe sont paginables au-delà de 30 jours. Seuls les objets
Event ont une rétention API complète limitée à 30 jours. La recherche PayPal
est découpée en fenêtres de 31 jours, puis paginée.

## Règles de synchronisation

- Chaque ligne a une clé unique `(provider, external_id)`.
- Chaque événement du webhook universel a une clé unique
  `(provider, event_id)` ; un second envoi du fournisseur est donc idempotent.
- Les imports et webhooks utilisent des upserts idempotents.
- Une donnée plus ancienne ne peut pas écraser une version plus récente.
- Les montants sont stockés en unités mineures entières avec leur devise.
- Les cartes sont limitées à la marque et aux quatre derniers chiffres.
- Aucun secret, client secret Stripe, jeton PayPal ou donnée carte complète
  n'est stocké.
- Chaque exécution conserve son origine, ses compteurs et son horodatage.
- Le registre `pay_webhook_events` ne conserve jamais le corps brut : uniquement
  son empreinte SHA-256, le type, l'objet, le statut et les clés de routage
  métier explicitement autorisées.
- Les exports Spiffy sont d'abord validés à blanc et réconciliés avant écriture.

## Contrat non destructif Supabase

La migration `sql/pay_core.sql` est strictement additive :

- uniquement de nouvelles tables préfixées `pay_` ;
- aucun `DROP`, `TRUNCATE`, `DELETE`, cascade destructive ou modification d'une
  table existante ;
- aucune permission `DELETE` ou `TRUNCATE` accordée au rôle serveur ;
- clés étrangères en `ON DELETE RESTRICT` ;
- écritures applicatives limitées à `INSERT` et `UPDATE` dans les tables Pay ;
- linter obligatoire via `npm run test:pay-sql`.

Les actions financières restent une couche séparée, désactivée par défaut et
protégée par une confirmation en deux étapes.

## Contrat du webhook universel

`netlify/functions/lib/pay-webhook-contract.mjs` est le contrat partagé par le
futur point d'entrée unique Stripe + PayPal. Il ne reçoit aucune fonction
d'écriture et ne crée aucun webhook concurrent. Pour chaque événement signé,
il produit une enveloppe minimale avec :

- la clé de déduplication `provider:event_id` ;
- l'empreinte du corps reçu, sans en conserver le contenu ;
- l'horodatage fournisseur utilisé pour refuser une mise à jour obsolète ;
- la cible centrale `pay`, puis les routes optionnelles dérivées uniquement de
  `pay_route`, `checkout_id`, `offer_slug` et `funnel` ;
- les références de plan de paiement sans email, secret ou donnée carte.

Les consommateurs métier comme MC2 pourront recevoir une notification dérivée
après la projection Pay, mais ne devront ni créer un webhook Stripe distinct ni
tenir une seconde logique de facturation.

La projection fournisseur est définie séparément dans
`netlify/functions/lib/pay-provider-projection.mjs`. Cette bibliothèque pure
normalise clients, produits, prix, checkouts, commandes, paiements,
remboursements, abonnements, plans et remises vers les tables `pay_*`. Elle ne
contient ni accès réseau ni écriture Supabase ; les relations sont conservées
par identifiants externes jusqu'à leur résolution transactionnelle par le
moteur central.

`netlify/functions/lib/pay-webhook-projection.mjs` relie ce contrat aux vrais
objets fournisseur en mode `dry_run`. Chaque événement reçoit une décision
explicite (`projected` ou `ignored`), une liste d'upserts proposés et, pour les
factures Stripe, un effet d'échéance à résoudre. Le résumé d'audit ne contient
ni email, ni nom, ni payload brut. Les captures, remboursements et abonnements
PayPal ainsi que les objets cœur Stripe sont couverts ; les événements hors MVP
sont ignorés avec un motif au lieu de créer une donnée approximative.

## Ordre de reprise historique

1. Importer à blanc les exports Spiffy.
2. Backfiller Stripe par pagination : clients, produits, prix, liens de
   paiement, intentions, charges, remboursements, factures et abonnements.
3. Backfiller PayPal par fenêtres de 31 jours.
4. Réconcilier par identifiants fournisseur, email normalisé, montant, devise
   et proximité temporelle, sans fusion automatique ambiguë.
5. Écrire uniquement les correspondances sûres ; placer les ambiguïtés dans un
   rapport de contrôle.
6. Basculer ensuite sur les webhooks universels et une réconciliation planifiée.

## Import Spiffy à blanc

L'importeur local ne contient volontairement aucun chemin d'écriture Supabase :

```bash
npm run pay:spiffy:dry-run -- /chemin/orders.csv --type orders
```

Types acceptés : `orders`, `customers`, `payments`, `payment_plans` et
`checkouts`. L'outil détecte les séparateurs, normalise les montants et dates,
rejette les identifiants manquants ou dupliqués, puis produit un checksum et un
rapport d'anomalies. Les options `--apply` et `--write` sont bloquées.

La réconciliation croisée produit uniquement des agrégats, sans email ni nom,
et vérifie les liens entre paiements, plans, commandes et clients :

```bash
npm run pay:spiffy:reconcile -- --orders orders.csv --customers customers.csv \
  --plans paymentplans.csv --payments payments.csv
```

Le contrôleur de parité va plus loin : il compare les checksums, volumes,
liaisons, ventes, remboursements, retards et projections calculés avec un
instantané agrégé réellement observé dans Spiffy. Il échoue dès qu'une valeur
change, sans écrire ni afficher aucune donnée personnelle :

```bash
npm run pay:spiffy:parity -- --snapshot docs/pay-spiffy-snapshot-2026-08-08.json \
  --orders orders.csv --customers customers.csv --plans paymentplans.csv \
  --payments payments.csv
```

## Audit fonctionnel Spiffy du 9 août 2026

La session réelle a confirmé le noyau à reproduire : Dashboard, Checkouts,
Products, Orders, Customers, Subscriptions, Payment Plans, Payments, Reports et
Discounts. L'affiliation, Fields et AI/MCP restent volontairement hors du MVP.

- les cinq listes de vente proposent recherche, export, filtres avancés et vues
  enregistrées ; Pay offre désormais ces mêmes contrôles sur toutes ses listes ;
- le dashboard propose l'intervalle calendrier, les quatre séries et les quatre
  indicateurs déjà vérifiés par le contrôleur de parité ;
- les brouillons de checkout existants restent accessibles, mais la création
  principale se fait désormais dans le code du site puis se relie à Stripe et
  PayPal par identifiants ; aucun éditeur visuel n'est requis ;
- un nouveau produit commence par le choix paiement unique ou abonnement ;
- une commande manuelle commence par le choix d'un checkout existant ;
- les rapports observés couvrent ventes par produit, valeur client, performance
  checkout et plans de paiement ; Pay ajoute cash-flow, échecs et taxes ;
- les réductions couvrent vente unique, abonnement, expiration, utilisation
  maximale et limite par client.
- les fiches commande, client et plan acceptent des notes internes locales ;
  elles restent limitées à la session et seront projetées dans `pay_notes`
  uniquement après l'autorisation d'écriture Supabase.
- les brouillons de checkout, produit et réduction peuvent être rouverts sans
  changer d'identifiant, modifiés puis supprimés uniquement après un second
  clic explicite ; ces opérations restent confinées au navigateur.
- la page Paiements mène directement au dossier client filtré par email ; une
  identité importée depuis Spiffy n'est pas additionnée une seconde fois à son
  double Stripe/PayPal ;
- le rapport Paiements échoués permet de préparer une première et une seconde
  relance. La règle est persistée localement pour la recette mais aucun email
  n'est envoyé avant le branchement explicite du stockage et de l'expéditeur.

Les créations de produit et de commande restent des interfaces de brouillon tant
que l'écriture Supabase et le moteur central Stripe ne sont pas explicitement
autorisés. Aucun de ces parcours ne doit créer de charge pendant la recette.

La publication du catalogue est décrite par le contrat pur
`netlify/functions/lib/pay-catalog-command.mjs` et l'exécuteur central
`netlify/functions/lib/pay-catalog-executor.mjs`. Produits, liens de paiement et
codes promotionnels sont validés, associés à une clé d'idempotence et exigent
une confirmation textuelle distincte liée à l'empreinte du brouillon. Le
contrat MC2 conserve exactement les
trois phases 47 € maintenant, 150 € à J+14 puis 11 × 197 €, dont la continuation
est réservée au webhook Pay universel. Le résultat reste `dry_run`, avec
`executable: false` jusqu'au deuxième geste. L'endpoint authentifié prépare
d'abord le plan sans écriture, puis n'autorise l'exécuteur qu'après recopie de
la confirmation et correspondance de l'empreinte. Le verrou
`PAY_STRIPE_CATALOG_WRITES_ENABLED=true` reste absent : aucune opération Stripe
n'est donc envoyée pendant la recette actuelle. Les plans complexes publient
un lien de paiement réutilisable pour l'acompte ; chaque achat sera ensuite
routé vers le webhook Pay central, jamais vers un webhook concurrent.

## Backfill fournisseur à blanc

Le backfill complet est exécutable sans écriture avec une borne de départ
obligatoire :

```bash
npm run pay:backfill:dry-run -- --provider both --from 2024-01-01T00:00:00Z
```

Stripe est paginé ressource par ressource au-delà de la rétention des Events.
PayPal est découpé en segments de 360 jours, eux-mêmes recherchés par fenêtres
de 31 jours par le client existant. Le même audit lit aussi nativement le
catalogue PayPal, les plans et les abonnements ; ces objets stables ne sont
chargés qu'une fois par backfill et jamais une fois par fenêtre de transactions.
Les opérations sont dédupliquées selon
`(table, provider, external_id)` et la version fournisseur la plus récente
gagne. Le rapport ne contient que les volumes, anomalies et un checksum ; il
n'affiche aucun email ni identifiant client. Les options `--write` et `--apply`
sont refusées.

## Réconciliation du 8 août 2026

Les quatre exports complets ont été validés à blanc :

- 1 841 / 1 841 commandes valides, du 12 novembre 2024 au 7 août 2026 ;
- 1 557 / 1 557 clients valides ;
- 552 / 552 plans valides : 56 actifs, 11 en retard, 166 impayés
  abandonnés et 319 terminés ;
- 385 / 385 paiements valides : 330 Stripe et 55 PayPal ;
- 385 paiements sur 385 reliés à une commande et un client ;
- 552 plans sur 552 reliés à une commande et un client ;
- aucun identifiant manquant, doublon ou lien orphelin.

L'export des abonnements est vide, ce qui correspond à l'écran Spiffy actuel.
Quinze réductions ont été repérées dans Spiffy ; leur reprise restera un import
séparé afin de ne pas activer par erreur un ancien code expiré.

## Sémantique du dashboard validée contre Spiffy

La comparaison du 8 août 2026 a permis de corriger un écart important entre
des chiffres techniquement Stripe et les indicateurs métier de Spiffy :

- **Ventes** : le montant additionne tous les encaissements réussis Stripe et
  PayPal, y compris les échéances, tandis que le compteur compte seulement les
  nouvelles commandes. L'export restitue bien les 7 commandes affichées par
  Spiffy sur les sept derniers jours ;
- **Remboursements** : somme et compteur des remboursements fournisseur, sans
  soustraire une deuxième fois un paiement déjà marqué remboursé ;
- **Cash flow** : somme des échéances encore attendues entre maintenant et la
  fin du mois, puis sur le mois suivant. Ce n'est ni le solde Stripe, ni le
  revenu déjà encaissé. La projection à blanc donne 454 220 centimes au
  8 août, soit les 4,5 k€ affichés par Spiffy ;
- **Rapport Cashflow Projection** : contrairement à la carte du dashboard, le
  rapport des 30 prochains jours conserve uniquement les plans `active` et
  exclut les `past_due`. La projection à blanc donne 628 196 centimes, soit
  les 6,3 k€ affichés par Spiffy ;
- **Plans en retard** : uniquement le statut Spiffy `past_due`, soit 11 plans.
  Les 166 plans `unpaid` restent distincts et ne gonflent plus cet indicateur ;
- **Courbe des plans** : échéances projetées à leur date, à partir du prochain
  paiement, de l'intervalle et du solde restant.

Le dashboard ne remplace plus ces définitions par une approximation basée sur
le nombre d'intentions Stripe ou le solde de la passerelle. Tant que l'historique
n'est pas initialisé, les indicateurs dépendants de Supabase affichent `—`.
Les points du graphique utilisent des clés calendaires stables et sont rendus
sans animation afin que chaque valeur reste exactement alignée avec son jour.
Stripe et PayPal sont chargés indépendamment : si une passerelle ne répond pas,
l'autre et la projection historique restent utilisables sans afficher de faux
zéros pour la source indisponible.

L'aperçu Stripe expose aussi sa fenêtre exacte et son éventuelle troncature. Il
n'est utilisé par la courbe que si toute la période demandée est couverte et si
aucune consolidation PayPal n'est encore attendue. Une série non disponible
vaut `null`, jamais zéro ; Pay affiche alors un état d'attente ou d'erreur sans
fabriquer de courbe ni de KPI.

Cette tolérance aux pannes s'applique aussi aux listes de ressources avant
l'initialisation de Supabase : commandes, clients, abonnements et plans peuvent
continuer à afficher la passerelle disponible si Stripe ou PayPal échoue. Dès
que l'historique normalisé est prêt, il reste la source autoritaire des objets
métier ; la page Paiements conserve en plus la priorité des objets live exacts
pour les statuts récents et les actions autorisées.

La fonction `pay-history` est strictement en lecture seule. Elle prépare les
agrégats à partir des tables `pay_*`, exige la session administrateur et renvoie
`ready: false` tant que la migration n'a pas été autorisée et appliquée.

Après initialisation, la même fonction alimente automatiquement les listes de
commandes, clients, paiements, abonnements, plans, produits, checkouts et
réductions. En l'absence d'historique, ces écrans continuent à lire directement
Stripe et PayPal. Sur la page Paiements, les objets live ont priorité sur une
ligne d'archive portant le même identifiant ; eux seuls peuvent proposer une
action de remboursement.

La synthèse de la page Transactions déduplique aussi les remboursements PayPal :
lorsqu'un événement de remboursement explicite existe, le montant déjà reflété
sur le paiement parent n'est pas additionné une seconde fois.

Lorsqu'une pagination Stripe complète remplace l'aperçu initial, les objets
récents enrichis gardent la priorité sur leur doublon d'archive. La charge et
le montant remboursable ne disparaissent donc plus après le chargement des
pages suivantes ; le garde-fou en deux étapes reste inchangé et verrouillé.

## État de parité du MVP

| Zone Spiffy | Pay | État |
| --- | --- | --- |
| Dashboard et calendrier | Graphique Stripe + PayPal, sémantique Spiffy validée, 4 séries, infobulles et périodes personnalisées | prêt avant import |
| Commandes, clients, paiements | Historique unifié, données live prioritaires, recherche, filtres, CSV et fiches détaillées | prêt avant import |
| Abonnements et plans | Objets Stripe et PayPal natifs, échéance PayPal exacte, repli transactionnel seulement si l'API native est refusée, historique Spiffy validé à blanc | prêt avant import |
| Checkouts | Liste Stripe, brouillons modifiables et publication centrale en deux confirmations | code prêt, Live verrouillé |
| Produits | Catalogues, prix et plans Stripe + PayPal réels, brouillons modifiables et publication idempotente | code prêt, Live verrouillé |
| Rapports | Produit, LTV, projection cash flow, plans, performance checkout, échecs et taxes par pays/passerelle, archive + live dédupliqués | prêt avant import |
| Réductions | Liste Stripe, brouillons modifiables, chaîne coupon + code promotionnel idempotente | code prêt, Live verrouillé |
| Remboursements | Stripe + PayPal, total ou partiel, confirmation en deux étapes | code prêt, Live verrouillé |
| Affiliés et MCP | Hors périmètre volontairement | exclu |

Les mentions « prêt » décrivent le code et l'interface. L'historique Supabase et
les actions Live ne sont pas activés tant que leur autorisation distincte n'a
pas été donnée.

La page Réglages sonde séparément les droits PayPal de recherche des
transactions, catalogue, plans, abonnements et factures. Une connexion OAuth
réussie n'est donc plus présentée comme un accès métier complet si un de ces
modules est refusé. Toutes ces sondes sont des requêtes `GET` ; aucune facture,
aucun plan et aucun abonnement PayPal n'est créé ou modifié.

## Recette Live en lecture seule du 9 août 2026

La version déjà déployée a confirmé que Stripe et PayPal répondent tous les
deux en mode réel, tandis que les actions financières restent verrouillées.
La pagination manuelle a parcouru les 3 647 intentions Stripe, du 12 novembre
2024 au 8 août 2026 : 2 060 réussies, 92 totalement remboursées, 3
partiellement remboursées, 1 017 incomplètes, 100 nécessitant une action et 375
annulées. Ces objets techniques ne doivent pas être comparés directement aux
385 paiements exportés par Spiffy, qui appliquent une sémantique métier plus
restrictive.

L'audit a aussi reproduit un défaut de l'ancienne version en ligne : après le
chargement paginé, l'archive remplaçait les objets récents enrichis et faisait
disparaître les actions disponibles. La priorité des objets live est corrigée
et testée dans cette branche. La preuve agrégée, sans donnée personnelle, est
conservée dans `docs/pay-live-read-audit-2026-08-09.json`.
