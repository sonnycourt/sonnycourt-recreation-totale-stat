# Entretien ES2

## Utilisation

- Élève : `/es2-entretien/`, puis « Commencer le questionnaire » depuis son lien personnel.
- Sonny : `/admin/es2-entretiens/`, connexion avec le mot de passe habituel de l’espace privé.
- Saisir l’email de l’élève pour créer ou retrouver son lien. Un email normalisé (minuscules, espaces retirés) possède exactement une ligne, un lien et une conversation. Une nouvelle invitation ne réinitialise jamais l’entretien.
- Copier le lien dans l’email destiné à cet élève. Aucun envoi ni automatisation J+14 n’est déclenché par ce code. Les messages et l’intégration à l’outil d’email restent à préparer et valider avec Sonny.
- L’élève peut revenir avec le même lien. La clôture explicite est définitive : lecture autorisée, ajout de messages refusé côté serveur.
- L’espace privé affiche la conversation et, après clôture, une synthèse structurée avec références aux messages de l’élève. Sonny vérifie ces éléments puis rédige sa réponse humaine. Aucun PDF ni réponse client automatique n’est généré.

## Configuration

Le SQL `sql/es2_interviews.sql` doit être exécuté par Sonny, jamais par l’agent. Il est réexécutable. La table est privée (RLS, aucun droit anon/authenticated), accessible aux fonctions par service_role uniquement.

Variables Netlify (functions) :
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` : configuration existante.
- `ANTHROPIC_API_KEY_ES2_ENTRETIEN` facultative, prioritaire sur `ANTHROPIC_API_KEY` existante.
- `ES2_ENTRETIEN_MODEL` facultative ; défaut `claude-fable-5-1`, sans remplacement silencieux par un modèle inférieur.
- `ES2_ENTRETIEN_TOKEN_SECRET` facultative ; défaut clé service_role. Ne pas changer après création des invitations sans migration dédiée : les jetons existants restent valides via leur hash mais leur récupération côté admin exige l’ancien secret.

Le token est un identifiant UUID aléatoire signé HMAC-SHA256, conservé en base sous forme SHA256. Le lien utilise `#t=…`, donc le secret ne part pas dans les logs URL du serveur/CDN. Le navigateur retire le fragment et garde le token en sessionStorage pour les rechargements du même onglet. Le token constitue le droit d’accès : quiconque obtient le lien peut lire cette conversation. Ne pas partager un lien entre élèves. L’unicité est par email, pas une vérification d’identité civile.

## Résilience et limites

Chaque commande et chaque travail IA écrit par mise à jour conditionnelle sur la version en base. Les doubles clics, requêtes répétées et traitements concurrents ne dupliquent pas les messages. La génération est exécutée dans une fonction Netlify background, avec signature interne, bail de 4 minutes, appel Anthropic limité à 150 secondes et 3 essais maximum par réponse. En cas de panne ambiguë du fournisseur, un nouvel essai peut occasionner un deuxième appel facturé, sans deuxième message sauvegardé.

La conversation est limitée à 40 réponses élève et 100 000 caractères cumulés ; chaque message élève est limité à 4 000 caractères. Ces limites bornent les coûts sans afficher de parcours à étapes. L’historique est sauvegardé après chaque envoi, pas pendant la saisie. Une synthèse échouée peut être relancée depuis l’espace privé, dans la même limite de trois essais. Si elle échoue définitivement, la conversation complète reste disponible.

L’assistante demande une permission avant d’explorer l’histoire personnelle, respecte les refus et ne suggère ni souvenirs ni diagnostic. Elle ne connaît pas le contenu détaillé des exercices ES2 : elle doit demander les précisions nécessaires, sans inventer de contenu de formation.

## Vérification

`npm run test:es2-interview` : parcours des fonctions avec fournisseur simulé, courses de concurrence, idempotence, reprise après panne, isolation des données, clôture définitive, authentification, schéma PostgreSQL réel local via PGlite et droits SQL. Aucun appel ni écriture de production.

`npm run deploy:check` puis le sas habituel ; production exclusivement via `npm run deploy:production` depuis main propre synchronisée avec origin/main.
