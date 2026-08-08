# Pay — audit express de Spiffy et périmètre MVP

## Ce qui compte dans Spiffy

- Le tableau de bord résume ventes, remboursements et cashflow.
- Les checkouts sont l'objet central : nom interne, URL publique, statut, ventes, clients, édition et statistiques.
- Un produit commence par un choix simple : paiement unique ou abonnement.
- Les ventes se déclinent ensuite en commandes, clients, abonnements, plans de paiement et paiements.
- Les connexions réellement indispensables sont Stripe et PayPal.

## Ce qu'on garde dans le premier MVP

- Un shell d'application interne, responsive et protégé par l'accès administrateur existant.
- Un tableau de bord clair avec des données de démonstration explicitement signalées.
- Une liste de checkouts avec recherche, filtre, copie du lien et brouillons locaux.
- Un parcours de création en trois étapes : informations, tarification, confirmation.
- Des pages cohérentes pour transactions, produits et réglages.
- Les accès directs correspondants depuis le Hub.

## Ce qu'on repousse volontairement

- Affiliation, rapports avancés, coupons et champs personnalisés.
- Upsells, order bumps, portail client et automatisations.
- Équipe, API publique et notifications avancées.
- Toute donnée financière réelle avant validation de l'interface.

## Deuxième tranche

1. Connecter Stripe en mode test et enregistrer les webhooks.
2. Persister produits, checkouts, clients et transactions.
3. Faire passer un premier paiement de bout en bout.
4. Ajouter PayPal Express après validation du flux Stripe.
