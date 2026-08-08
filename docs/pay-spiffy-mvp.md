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
  performance des plans, projection de trésorerie et paiements échoués.
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
