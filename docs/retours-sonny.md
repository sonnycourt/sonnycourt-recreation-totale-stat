# Retours Sonny — page de saisie et continuité CRM

## Utilisation

- Page `/retours-sonny/`, connexion avec le **compte propriétaire existant du CRM onboarding**. Romain ne peut pas y enregistrer/modifier les réponses de Sonny.
- Les bilans de `es2_feedback` arrivent automatiquement dans « À traiter ». Une actualisation de liste par minute, sans remplacer le brouillon ouvert.
- Cliquer sur le prénom/email : toutes les réponses enregistrées du bilan (ancien formulaire et point personnel v2) sont reconstituées, sans afficher le token d’accès. Le texte peut être complété dans la copie conservée avec le retour ; le bilan d’origine n’est jamais modifié.
- Coller le retour déjà préparé/envoyé par email, indiquer sa date et enregistrer. La page **n’envoie aucun message** et ne prétend pas vérifier si l’email est parti.
- « Ajouter un ancien retour » permet de renseigner l’email, le prénom, la demande, le retour et la date. Ne pas ressaisir manuellement un bilan déjà dans « À traiter » : ouvrir celui-ci pour éviter un doublon rétrospectif.
- Le rapprochement CRM est fait par email normalisé exact. La fiche et son nom sont affichés avant sauvegarde. Sans fiche, le retour est conservé et deviendra lisible si une fiche de cet email est créée ultérieurement. Aucune création automatique de dossier, aucun rapprochement approximatif prénom/nom.
- Le CRM affiche « Bilan personnel avec Sonny » en lecture seule sur la fiche autorisée, avec les réponses enregistrées les plus récentes en premier. Les 100 derniers retours maximum ; un message signale un historique plus grand.
- L’email/source est immuable après création, pour empêcher une réattribution accidentelle. Les corrections de texte/date sont versionnées. Aucune suppression dans l’interface.

## Source Telegram examinée

`netlify/functions/submit-es2-feedback.js` enregistre `es2_feedback` avant d’envoyer la notification Telegram. Le format v2 est défini par `src/lib/es2-feedback.mjs` ; il est stocké dans les colonnes historiques, sans nouvelle colonne JSON. La nouvelle page utilise ces données existantes, pas la lecture des messages Telegram.

**Aucun changement** à cette fonction, au bot, aux emails, au formulaire élève, au paiement ou aux accès. Les anciens retours envoyés par email ne sont pas inventés : Sonny les recopie lui-même.

## Activation — SQL par Sonny uniquement

1. Sonny exécute **uniquement** `sql/es2_feedback_replies.sql` dans Supabase. Le fichier est transactionnel et réexécutable ; le résultat attendu est `sonny_feedback_ready = true`.
2. Vérifier en lecture seule l’installation et les privilèges. Deux nouvelles tables privées : `es2_feedback_replies` et `es2_feedback_reply_revisions`. Aucun dossier ni ancien bilan n’est réécrit.
3. Vérifier la preview, fusionner explicitement la branche dans `main`, puis publier avec `npm run deploy:production` depuis un `main` propre identique à `origin/main`. Pas de publication directe depuis ce worktree.
4. Tester la lecture authentifiée des demandes, sans envoyer d’email ni modifier un vrai dossier pour un test. Le premier vrai retour enregistré par Sonny vérifiera le parcours de bout en bout en production.

Sans SQL, la page de saisie refuse d’enregistrer avec une explication ; le CRM affiche les retours indisponibles et continue de fonctionner. Ne pas réexécuter d’anciennes migrations onboarding pour installer ce module.

## Sécurité et conservation

Cookie signé HttpOnly existant ; rôle `owner` actif vérifié côté serveur et dans les RPC. Romain lit seulement après contrôle de l’attribution de la fiche par l’API onboarding existante. Les tables/RPC ne sont pas accessibles à `anon` ou `authenticated` ; RLS active, clé service-role uniquement côté serveur. API same-origin, en-tête anti-CSRF, cache privé `no-store`. Pas d’analytics ou de ressource tierce sur la nouvelle page.

Identifiant de commande idempotent, verrou et version contre les modifications concurrentes. Historique avant/après append-only dans la même transaction ; un échec de journal annule l’écriture. Une répétition de commande ne réécrit pas la réponse. Les textes sont échappés à l’affichage, jamais interprétés comme HTML.

Les brouillons restent en mémoire, **pas en localStorage**. Avertissement avant changement de demande/fermeture ; bouton Copier le brouillon. Une fermeture forcée peut perdre une saisie non enregistrée. Le journal conserve les versions enregistrées, pas les frappes.

## Validation locale

`node scripts/sonny-feedback-smoke.mjs` : PostgreSQL éphémère PGlite, migration x2, historique rétrospectif, rôles, RLS, liaison exacte, conflits, reprises réseau, rollback du journal, API et échappement HTML. Aucun réseau réel.

Régressions : onboarding-crm, session, coachings, organization, workflow, paid-buyers, country, payments et es2-feedback. Build Astro complet.

Démo : `/retours-sonny/?demo=1` et `/onboarding/?demo=1&case=00000000-0000-4000-8000-000000000001`. Données fictives, mémoire de chaque page seulement : les nouvelles saisies de démonstration ne se synchronisent pas entre les deux pages et disparaissent au rechargement.
