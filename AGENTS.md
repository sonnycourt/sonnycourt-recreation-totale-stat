# Règles communes Claude Code + Codex

Ce fichier est la règle permanente du projet. Il doit être lu avant toute
modification, dans chaque nouveau chat et dans chaque nouveau worktree.

## Règle absolue de production

- Ne jamais lancer directement `netlify deploy --prod`.
- Ne jamais déverrouiller, restaurer ou republier un déploiement Netlify à la
  main, sauf demande d'urgence explicite de Sonny.
- Le seul chemin autorisé vers la production est :

  ```bash
  npm run deploy:production
  ```

- Pour montrer une version à Sonny sans toucher au site :

  ```bash
  npm run deploy:preview
  ```

## Travail parallèle

- Claude et Codex travaillent chacun dans leur propre branche/worktree.
- Ne jamais utiliser le dossier de travail d'un autre agent pour déployer.
- Une tâche peut toucher la même page qu'une autre, mais les changements doivent
  être fusionnés explicitement. Un conflit doit être résolu, jamais écrasé.
- `main` est l'unique source officielle. Un déploiement de production n'est
  autorisé que depuis un `main` propre, identique à `origin/main`.

## Ce que le sas vérifie automatiquement

Le script de production refuse de publier si :

- le dossier contient des changements non commités ;
- la branche n'est pas `main` ;
- `main` n'est pas parfaitement synchronisée avec GitHub ;
- un autre déploiement est déjà en cours ;
- la version en ligne n'appartient pas à l'historique de la nouvelle version ;
- une page critique disparaît ou perd ses marqueurs essentiels ;
- le build ou la prévisualisation échoue.

La production Netlify doit rester verrouillée entre deux publications. Les
déploiements automatiques issus d'un push Git sont volontairement ignorés.

## Pages protégées

Les protections couvrent notamment :

- `/invitation-xmen/`
- les six checkouts `/invitation-es2-*`
- `/masterclass/`, `/meta/masterclass/` et `/tt/masterclass/`
- `/admin/masterclass-optin/`
- `/masterclass/confirmation/`
- `/coach/` et `/coach-romain/`
- les fonctions de tracking associées

La liste technique complète se trouve dans
`deploy/critical-routes.json`. Modifier cette liste pour contourner une erreur
est interdit. Une modification volontaire doit être expliquée à Sonny.

## En cas de doute

Arrêter avant de publier. Une preview est toujours autorisée ; une production
incertaine ne l'est jamais.
