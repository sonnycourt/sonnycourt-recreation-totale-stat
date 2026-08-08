# Pay — audit express de Spiffy et périmètre MVP

## Ce qui compte dans Spiffy

- Le tableau de bord résume ventes, remboursements et cashflow.
- Les checkouts sont l'objet central : nom interne, URL publique, statut, ventes, clients, édition et statistiques.
- Un produit commence par un choix simple : paiement unique ou abonnement.
- Les ventes se déclinent ensuite en commandes, clients, abonnements, plans de paiement et paiements.
- Les connexions réellement indispensables sont Stripe et PayPal.

## Ce qu'on garde dans le premier MVP

- Un shell d'application interne, responsive et protégé par l'accès administrateur existant.
- Un tableau de bord clair, relié en lecture seule aux chiffres et transactions Stripe.
- Une liste de checkouts avec recherche, filtre, copie du lien et brouillons locaux.
- Un parcours de création en trois étapes : informations, tarification, confirmation.
- Des pages cohérentes pour transactions, produits et réglages.
- Les accès directs correspondants depuis le Hub.

## Ce qu'on repousse volontairement

- Affiliation, rapports avancés, coupons et champs personnalisés.
- Upsells, order bumps, portail client et automatisations.
- Équipe, API publique et notifications avancées.
- Toute écriture financière réelle avant validation du flux Stripe en mode test.

## Deuxième tranche

1. ✅ Connecter Stripe en lecture seule : compte, solde et transactions réelles.
2. Ajouter une clé Stripe dédiée au mode test pour créer produits et checkouts sans toucher au catalogue réel.
3. Enregistrer les webhooks et persister produits, checkouts, clients et transactions.
4. Faire passer un premier paiement de bout en bout.
5. Ajouter PayPal Express après validation du flux Stripe.
