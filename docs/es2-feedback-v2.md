# Point personnel ES2 — 10 octobre 2026

Intégration de la maquette validée dans `/es2/feedback/`. Pas de modification
du funnel, du checkout, du CRM ou de l'endpoint d'accès.

## Contrat conservé

- Accès par `t`, `token` ou email, vérification de l'achat côté serveur inchangée.
- Même fonction `submit-es2-feedback`, même table `es2_feedback`, même identité
  résolue depuis le token (jamais depuis un prénom/email fourni par le client).
- V2 : `{ token, form_version: 2, answers }`. Ancien payload J+30 toujours accepté
  pour les formulaires déjà ouverts avant la publication.
- Notification Telegram attendue après l'insertion, mêmes variables d'environnement
  et même destinataire. Même repli MailerLite si Telegram échoue.
- Aucun message client supplémentaire, aucune nouvelle automation.

## Conservation des réponses sans migration

Schéma réel vérifié en lecture seule : `module_reached` et `score` acceptent NULL.
La contrainte de score n'interdit pas NULL. Le SQL historique du dépôt déclare
ces colonnes NOT NULL et ne représente donc pas le schéma actuellement déployé.
Ne pas recréer la table à partir de ce vieux fichier pour V2 sans adapter ces
deux colonnes. Aucune migration ni écriture SQL n'a été exécutée pour cette tâche.

- `module_reached`, `score` : NULL (questions retirées, aucune valeur inventée).
- `daily_practice` : fréquence choisie.
- `what_changed` : marqueur `[Point personnel v2]`, évolution et branche associée.
- `biggest_win` : exemple concret facultatif.
- `what_blocks` : ressenti, priorité, souhait, situation, vécu intérieur, sens du
  changement, pratiques essayées et freins, avec des intitulés explicites.
- `help_needed` : aide souhaitée, question prioritaire et contexte complémentaire.

Tous les textes saisis restent intégraux. Les réponses d'une branche devenue
invisible sont ignorées pour éviter les contradictions. Les anciens enregistrements
ne sont pas modifiés. Telegram utilise du texte brut et des messages numérotés
de 3 500 caractères, espacés pour éviter les rafales. Au-delà de six parties,
le récit complet est transmis dans un document texte au même chat.

## Vérifications

- `npm run test:es2-feedback` : fonctions réelles avec fetch entièrement simulé ;
  autorisation, identité serveur, ancien/nouveau format, cinq évolutions possibles,
  validation, stockage complet, long texte/Unicode, pièce jointe très longue,
  notification attendue et repli email, échec DB sans notification.
- `npm run test:deploy-runtime` : garde-fous existants.
- `npm run build` : 321 pages compilées.
- Parcours navigateur local : erreur champ vide, cinq étapes, contexte de la
  priorité, embranchement positif, fréquences, relecture, succès preview.
- Contrôle mobile 390 px : pas de débordement horizontal, champs et vue complète.
- Test navigateur hors preview avec les fonctions réelles et des services simulés :
  connexion email, token, soumission, succès, exactement un enregistrement et une
  notification complète. Fixture reproductible :
  `node scripts/es2-feedback-local-test-server.mjs` (nécessite `npm run build`).
- `?preview=dev` : aucun appel d'accès ni de soumission ; message de test explicite.
- Prévisualisation Netlify et contrôles des routes protégées réussis.

Aucune soumission réelle d'élève ni notification réelle de test n'a été effectuée.
