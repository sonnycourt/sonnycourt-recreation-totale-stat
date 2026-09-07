# MC2 — dépendances absentes du paquet Netlify

## Cause confirmée

Le 7 septembre 2026 à 15:21 UTC, `GET /.netlify/functions/register-mc2`
répondait 502 : `Cannot find package 'stripe' imported from .../register-mc2.mjs`.
La fonction importe indirectement Stripe via le filtre pays des SMS.
La même fonction sert les inscriptions organiques et Meta.

Le `node_modules` du worktree de publication était un lien symbolique vers
le dossier principal. Reproduction avec le packager Netlify installé :
le ZIP contenait l'entrée `node_modules` seule, pas les fichiers des dépendances.
Les tests de sources locaux ne détectaient pas ce défaut du paquet publié.

## Correction

- Remplacement du lien du worktree par une copie locale réelle des dépendances
  déjà installées, sans changer leurs versions ni le dossier principal.
- Refus des futurs builds sécurisés avec un `node_modules` absent ou symbolique.
- Sept sondes de démarrage des fonctions MC2 sur la preview obligatoire avant
  déverrouillage de la production, puis sur le déploiement publié.
- Les sondes sont des GET sans identifiants et un POST d'inscription vide,
  rejetés avant accès aux données ou envoi de communication.
- Aucun changement du parcours, des pages, du paiement ou du schéma Supabase.

## Vérifications

- Tests des gardes : dossier absent/lien, réponses 502, corps erroné, timeout.
- Exécution des vraies fonctions pour chaque sonde avec tout accès réseau interdit.
- Nouveau ZIP d'inscription extrait dans un dossier isolé : import réussi,
  GET 405 et POST vide 400, sans accès aux dépendances du projet d'origine.
- Tests Meta opt-in et emails de session : OK.

Ces contrôles prouvent le démarrage du serveur, pas une inscription réelle
jusqu'à la réception des emails. Aucun prospect, email ou SMS de test n'a été créé.
La campagne Meta reste en pause jusqu'à validation explicite.
