# Support MC2 dans Codex

Ce module permet à un membre autorisé de demander à Codex un diagnostic individuel MC2 à partir d’une adresse email.

## Périmètre

- Lecture seule : aucune fonction d’écriture Supabase n’est importée.
- Résultat anonymisé : l’API ne renvoie ni l’adresse email recherchée, ni le prénom, ni le numéro de téléphone, ni le token unique, ni les identifiants Stripe ou Spiffy.
- Accès individuel : chaque opérateur dispose d’une clé distincte dans `MC2_SUPPORT_API_KEYS`.
- Audit minimal : chaque consultation journalise l’opérateur, un hash tronqué de l’email recherché et le statut du diagnostic. L’email en clair n’est pas journalisé.
- Pas d’envoi : le module ne peut ni envoyer un email/SMS, ni relancer une automation, ni modifier une inscription ou un paiement.

## Données diagnostiquées

- validité et horaire de l’inscription ;
- ouverture de la page, connexion et lecture live/replay ;
- exposition à l’offre et visibilité réelle du checkout ;
- confirmation d’achat ;
- état des emails de session, SMS et emails de replay.

## Configuration de production

L’API attend `MC2_SUPPORT_API_KEYS`, un objet JSON associant un nom d’opérateur à une clé aléatoire d’au moins 32 caractères :

```json
{"operateur":"cle-aleatoire-individuelle"}
```

Le poste de l’opérateur reçoit uniquement sa propre clé dans `MC2_SUPPORT_API_TOKEN`. La clé ne doit jamais être ajoutée au dépôt Git ni écrite dans le plugin.

## Plugin

Le plugin se trouve dans `plugins/mc2-support`. Sa skill déclenche automatiquement le script de diagnostic pour les demandes concernant l’accès, les sessions, la vidéo, le replay, les communications, l’offre, le checkout ou l’achat MC2.
