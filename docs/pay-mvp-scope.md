# Pay — audit express de Spiffy et périmètre MVP

## Ce qui compte dans Spiffy

- Le tableau de bord résume ventes, remboursements et cashflow.
- Les checkouts sont l'objet central : nom interne, URL publique, statut, ventes, clients, édition et statistiques.
- Un produit commence par un choix simple : paiement unique ou abonnement.
- Les ventes se déclinent ensuite en commandes, clients, abonnements, plans de paiement et paiements.
- Les connexions réellement indispensables sont Stripe et PayPal.

## Ce qu'on garde dans le premier MVP

- Un shell d'application interne, responsive et protégé par l'accès administrateur existant.
- Un tableau de bord clair, relié aux chiffres et transactions Stripe.
- Les remboursements Stripe totaux ou partiels, réservés à l’administrateur et confirmés explicitement.
- Une liste de checkouts avec recherche, filtre, copie du lien et brouillons locaux.
- Un parcours de création en trois étapes : informations, tarification, confirmation.
- Des pages cohérentes pour transactions, produits et réglages.
- Les accès directs correspondants depuis le Hub.

## Règle de sécurité des actions importantes

- Étape 1 : l’administrateur clique volontairement sur l’action souhaitée.
- Étape 2 : Pay ouvre un récapitulatif et exige un second clic explicite sur « Confirmer ».
- Cette règle s’applique notamment aux remboursements, annulations, suppressions et changements d’abonnement.
- Aucune action sensible ne doit partir automatiquement, par navigation ou au premier clic.

## Ce qu'on repousse volontairement

- Affiliation et champs personnalisés.
- Upsells, order bumps, portail client et automatisations.
- Équipe, API publique et notifications avancées.
- La création de paiements, produits ou abonnements réels avant validation du flux Stripe en mode test.

## Deuxième tranche

1. ✅ Connecter Stripe en lecture seule : compte, solde et transactions réelles.
2. ✅ Piloter les remboursements totaux et partiels depuis Pay avec garde-fou pour le mode réel.
3. ✅ Connecter PayPal Live en lecture seule et préparer les remboursements avec le même verrouillage.
4. ✅ Construire rapports, réductions, checkouts et listes Stripe + PayPal.
5. Appliquer la projection Supabase additive après autorisation explicite, puis importer l'historique Spiffy.
6. Raccorder Pay au webhook Stripe universel et à la synchronisation PayPal durable.
7. Faire passer un premier paiement de bout en bout en mode test avant toute activation Live.
