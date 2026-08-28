---
name: mc2-support
description: Diagnostiquer en lecture seule le parcours d’un prospect MC2 à partir de son adresse email. Utiliser pour les problèmes d’accès, de session, de vidéo, de replay, d’emails, de SMS, d’offre, de checkout ou de confirmation d’achat MC2. Ne pas utiliser pour modifier une inscription, renvoyer un message, déployer ou intervenir sur un paiement.
---

# Support MC2

Demander l’adresse email exacte si elle n’est pas déjà fournie, puis exécuter depuis le dossier de cette skill :

```bash
node scripts/diagnose.mjs --email "adresse@example.com"
```

Le script interroge uniquement le diagnostic MC2 de production, protégé par `MC2_SUPPORT_API_TOKEN`. Il ne peut effectuer aucune écriture.

Répondre en français, simplement :

1. Donner le diagnostic principal en une phrase.
2. Citer les preuves utiles avec les horaires et la timezone du prospect.
3. Distinguer une panne confirmée, un comportement normal et une absence de preuve.
4. Signaler les communications en échec ou en retard sans prétendre qu’un email a été ouvert : les statuts confirment la remise au groupe ou l’envoi, pas l’ouverture, sauf donnée explicite.

Contraintes absolues :

- Ne jamais afficher, demander ou reconstituer le token unique du prospect.
- Ne jamais afficher de numéro de téléphone, d’identifiant Stripe/Spiffy ou de clé d’accès.
- Ne jamais modifier de données, relancer une automatisation, envoyer un message, rembourser, déployer ou exécuter du SQL.
- Si le script renvoie une erreur d’autorisation, arrêter et demander à Sonny de réactiver l’accès ; ne pas chercher un autre chemin vers les données.
- Si une source est indiquée comme indisponible, le dire clairement et limiter le diagnostic aux preuves présentes.
