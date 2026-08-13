# Recouvrement des échéances MC2

## Flux final

1. Stripe tente l’échéance automatiquement avec la carte enregistrée.
2. En cas d’échec, Stripe planifie jusqu’à 5 relances intelligentes sur 14 jours.
3. Chaque échec est enregistré dans Supabase et place le client dans le groupe MailerLite correspondant.
4. Le lien de l’email ouvre `/paiement/actualiser/` puis le portail sécurisé Stripe.
5. La nouvelle carte remplace automatiquement celle du client **et** celle de l’échéancier.
6. L’échéance en attente est immédiatement retentée.
7. Dès que le paiement passe, les tâches et groupes de relance sont supprimés.
8. Après le dernier échec, le dossier reste traçable pour le recouvrement manuel.

Stripe envoie déjà ses notifications transactionnelles d’échec de carte. Elles
restent le filet de sécurité, notamment pour un acheteur désabonné des emails
marketing. La séquence MailerLite est une couche personnalisée supplémentaire et
reste désactivée tant que ses textes ne sont pas validés.

## Activation, dans cet ordre

1. Exécuter `sql/mc2_payment_recovery.sql` dans Supabase.
2. Publier l’automatisation Stripe limitée au produit `Esprit Subconscient 2.0 — Échéancier MC2`.
3. Créer les huit automatisations MailerLite déclenchées par les groupes `MC2 — …` si la couche personnalisée est souhaitée.
4. Ajouter `MC2_DUNNING_ENABLED=true` dans Netlify.
5. Déployer uniquement via `npm run deploy:production` depuis un `main` propre.

Ne jamais activer l’étape 4 avant les trois premières.

## Événements Stripe nécessaires

- `invoice.payment_failed`
- `invoice.payment_action_required`
- `invoice.updated`
- `invoice.paid`
- `customer.updated`

Ils sont déjà abonnés sur le webhook `pay.sonnycourt.com`.

## Modèle email provisoire

Objet : `Ton échéance Esprit Subconscient 2.0 n’est pas passée`

> Bonjour {$name},
>
> Stripe n’a pas réussi à valider ton échéance. Le plus simple est de vérifier ou remplacer ta carte maintenant.
>
> **METTRE À JOUR MA CARTE**
>
> `https://sonnycourt.com/paiement/actualiser/?t={$unique_token_webinaire}`
>
> Si tu viens de corriger la situation, tu n’as rien d’autre à faire.
>
> Sonny

La sixième version doit annoncer clairement qu’il s’agit de la dernière tentative automatique. Le texte définitif pourra remplacer ce modèle sans toucher au code.

## Variables Netlify

- `MAILERLITE_API_KEY`
- `MAILERLITE_GROUP_MC2_PAYMENT_FAILED_1` à `_6`
- `MAILERLITE_GROUP_MC2_PAYMENT_ACTION_REQUIRED`
- `MAILERLITE_GROUP_MC2_PAYMENT_FINAL_FAILED`
- `MC2_DUNNING_ENABLED`
- optionnel : `STRIPE_MC2_PORTAL_CONFIGURATION_ID`

## Visibilité dans Pay

La page `/pay/orders/` rapproche chaque commande MC2 de `mc2_registrations` par l’identifiant Stripe de Checkout, puis affiche la récupération la plus récente sans envoyer le token MC2 au navigateur.

La colonne `Recouvrement` indique :

- `À jour` si aucun incident n’existe ;
- `Relance n/5` et la prochaine date pendant les reprises Stripe ;
- `Action requise` si la banque demande une authentification ;
- `Récupéré` après régularisation ;
- `Recouvrement` lorsque les cinq reprises sont épuisées.

La fiche détaillée contient le montant, les tentatives, le motif bancaire et les dates utiles au suivi manuel.
