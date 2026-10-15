# Avis Delta Vision

## Activation
1. Sonny exécute `sql/delta_vision_reviews.sql` dans le projet Supabase utilisé par les variables Netlify SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Attendre `delta_reviews_ready = true`.
2. Contrôler la migration, tester le parcours puis fusionner explicitement dans main.
3. Publier uniquement avec `npm run deploy:production`, depuis main propre et synchronisée. Ne jamais déployer depuis le worktree d'un autre agent.

## Liens après publication
- Formulaire : https://sonnycourt.com/delta-vision/review/
- Consultation privée : https://sonnycourt.com/admin/delta-vision-reviews/
- Accès admin : mot de passe habituel ES2 / hub. Aucun nouvel identifiant.
- Sonny a confirmé qu'il n'existe pas de suivi journalier : aucun bouton ni page de suivi à modifier. Le lien direct est prêt pour sa formation ou son futur email.

## Données et confidentialité
Table delta_vision_reviews : prénom, email, étoiles 1–5, avis, suggestion facultative, date.
Toutes les notes sont acceptées de la même façon. Avis et suggestions restent privés.
Aucun achat ni email vérifié : les coordonnées sont déclaratives, jamais un justificatif d'identité.
Pas de lecture/écriture publique Supabase. Enregistrement via fonction serveur, consultation via session admin existante.
Aucune publication de témoignage, aucun email ou message Telegram n'est créé.
Prénom/email mémorisés dans une clé locale dédiée après succès ; effacement disponible. Brouillon temporaire de session pour restaurer un onglet rechargé (24 h maximum).
Les identités d'autres services/domaines ne sont pas récupérées automatiquement. Aucun email ajouté dans l'URL.

## Vérifications
`node scripts/delta-vision-reviews-smoke.mjs` teste sans accès réseau et avec PostgreSQL local PGlite.
Limitation anti-abus Netlify : 5 requêtes/minute/IP/domaine, honeypot, contrôle origine, taille et champs.
UUID d'envoi conservé lors d'une nouvelle tentative : pas de doublon après interruption réseau. Aucun avis existant écrasé.
L'écran de réussite n'apparaît qu'après confirmation serveur.
