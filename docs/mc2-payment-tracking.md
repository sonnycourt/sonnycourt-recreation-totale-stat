# Suivi financier MC2 séparé du parcours client

## Contraintes

- Aucun changement dans src/, public/, les formulaires, les délais d'offre, les lecteurs ou les campagnes Meta.
- Aucun appel ajouté aux webhooks de paiement existants. Le suivi n'est jamais une dépendance d'un achat.
- Source : lecture GET de l'API Spiffy, commande identifiée par le purchase_completed serveur MC2.
- Aucun envoi client et aucune création/modification de paiement.
- Deux interrupteurs désactivés à l'installation : collecte puis livraison Meta.
- Les schémas sont appliqués uniquement par Sonny.

## Signaux prévus

- MC2_CommitmentConfirmed : engagement confirmé, montant 0, une fois par commande.
- MC2_PaymentCollected : encaissement réel, une fois par échéance logique (retries regroupés).
- MC2_PaymentRefunded / MC2_PaymentDisputed : événements distincts, jamais une somme négative présentée comme achat.
- Les événements de remboursement ne corrigent pas automatiquement les statistiques Purchase de Meta.
- Les achats Purchase historiques restent inchangés ; ces nouveaux noms n'ajoutent aucun faux achat standard et n'impliquent aucun changement d'optimisation.
- Journal local conservant montants payés, remboursés, états et provenance, indépendamment de l'attribution Meta.

## Mise en service

1. SQL additif, aucun trigger sur les tables du parcours existant, RLS serveur uniquement.
2. Tests de domaine et de livraison simulée sans appel externe.
3. Vérification de snapshots Spiffy réels en lecture seule, notamment dates de paiement et reprises.
4. Collecte seule, contrôler le rapprochement des commandes et échéances.
5. Activation Meta explicite après contrôle. Les anciennes données ne sont pas redatées pour contourner la fenêtre d'acceptation de Meta.
6. Production uniquement par npm run deploy:production depuis main propre synchronisée.

## Limites à résoudre avant activation

Vérifier la sémantique exacte des dates Spiffy (created_at d'une échéance n'est pas nécessairement la date d'encaissement), la pagination complète et les identifiants de tentatives. Toute ambiguïté doit bloquer la remontée concernée, jamais le parcours client.

Cette préparation de schéma n'est pas une preuve de déploiement ou d'activation.
