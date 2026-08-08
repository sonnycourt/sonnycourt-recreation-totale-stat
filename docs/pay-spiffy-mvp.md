# Pay — périmètre Spiffy interne

Audit fonctionnel réalisé le 8 août 2026 sur le compte Spiffy de Sonny Court,
en lecture seule.

## Périmètre retenu

- Tableau de bord combiné Stripe + PayPal : ventes, remboursements, commandes,
  encaissements attendus, échéances et impayés.
- Checkouts : liste, recherche, statut, lien, statistiques, création et édition.
- Catalogue : produits, prix uniques et récurrents.
- Ventes : commandes, clients, paiements, abonnements et plans de paiement.
- Remises : montant fixe ou pourcentage, date d'expiration, usage unique par
  client, application aux paiements uniques ou récurrents.
- Rapports : ventes par produit, valeur client, performance des checkouts,
  performance des plans, projection de trésorerie, paiements échoués et taxes
  sur les ventes par pays et passerelle.
- Exports CSV filtrés.
- Fiches commande, client et plan avec historique et notes.

L'affiliation, les parrainages et l'interface MCP de Spiffy sont hors MVP.

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
- Les imports et webhooks utilisent des upserts idempotents.
- Une donnée plus ancienne ne peut pas écraser une version plus récente.
- Les montants sont stockés en unités mineures entières avec leur devise.
- Les cartes sont limitées à la marque et aux quatre derniers chiffres.
- Aucun secret, client secret Stripe, jeton PayPal ou donnée carte complète
  n'est stocké.
- Chaque exécution conserve son origine, ses compteurs et son horodatage.
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

La fonction `pay-history` est strictement en lecture seule. Elle prépare les
agrégats à partir des tables `pay_*`, exige la session administrateur et renvoie
`ready: false` tant que la migration n'a pas été autorisée et appliquée.

Après initialisation, la même fonction alimente automatiquement les listes de
commandes, clients, paiements, abonnements, plans, produits, checkouts et
réductions. En l'absence d'historique, ces écrans continuent à lire directement
Stripe et PayPal. Sur la page Paiements, les objets live ont priorité sur une
ligne d'archive portant le même identifiant ; eux seuls peuvent proposer une
action de remboursement.

## État de parité du MVP

| Zone Spiffy | Pay | État |
| --- | --- | --- |
| Dashboard et calendrier | Graphique Stripe + PayPal, sémantique Spiffy validée, 4 séries, infobulles et périodes personnalisées | prêt avant import |
| Commandes, clients, paiements | Historique unifié, données live prioritaires, recherche, filtres, CSV et fiches détaillées | prêt avant import |
| Abonnements et plans | Listes réelles et historique Spiffy validé à blanc | prêt avant import |
| Checkouts | Liste Stripe et constructeur de brouillon | publication en attente du moteur Stripe central |
| Produits | Catalogue et prix Stripe réels | lecture prête |
| Rapports | Produit, LTV, projection cash flow, plans, performance checkout, échecs et taxes par pays/passerelle, archive + live dédupliqués | prêt avant import |
| Réductions | Liste Stripe et constructeur de brouillon en deux étapes | publication verrouillée |
| Remboursements | Stripe + PayPal, total ou partiel, confirmation en deux étapes | code prêt, Live verrouillé |
| Affiliés et MCP | Hors périmètre volontairement | exclu |

Les mentions « prêt » décrivent le code et l'interface. L'historique Supabase et
les actions Live ne sont pas activés tant que leur autorisation distincte n'a
pas été donnée.
