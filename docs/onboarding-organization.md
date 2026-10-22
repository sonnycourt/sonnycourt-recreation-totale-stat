# Organisation CRM Romain — activation et périmètre

Version préparée le 22 octobre 2026. Non publiée à ce stade.

## Activation

1. Sonny exécute `sql/onboarding_organization.sql` dans Supabase et vérifie que `onboarding_organization_ready` vaut `true`.
2. Vérifier en lecture seule le résultat et les trois réparations ciblées. Un dossier modifié depuis le diagnostic est volontairement ignoré.
3. Prévisualiser, puis intégrer explicitement la branche à main. Production uniquement avec `npm run deploy:production`, depuis main propre et identique à origin/main.

La migration est transactionnelle et réexécutable. Elle ajoute des tables privées pour l’organisation et son journal. Les notes existantes ne sont ni supprimées ni réécrites. Les trois corrections historiques touchent seulement statut, prochaine action, rappel et version, avec journal avant/après.

## Comportement

- Un nouveau contact ne remet plus un onboarding réalisé dans les dossiers en cours. La réouverture manuelle reste possible.
- L’archivage masque le dossier des listes actives et de l’agenda, mais conserve notes, rendez-vous et historique. Restauration via le filtre Dossiers archivés. Il ne suspend ni paiement ni accès élève.
- Le fuseau IANA est confirmé avec l’élève ; il n’est pas déduit automatiquement du pays. Le décalage avec Paris est calculé à la date du rendez-vous, changements d’heure compris.
- L’agenda hebdomadaire regroupe onboardings et trois coachings planifiés. Les rendez-vous réalisés, annulés ou les dossiers archivés sont exclus. Les dates se modifient dans la fiche existante, avec ses contrôles habituels.
- Un lien HTTPS peut être enregistré pour chaque rendez-vous. Aucun événement Google Calendar/Meet ni invitation n’est créé.
- L’adresse email reste accessible depuis la fiche. L’import de conversations et une boîte email centralisée ne sont pas implémentés. Aucun envoi automatique n’est ajouté ; toute future communication passe par le circuit de validation et MailerLite uniquement.

## Sécurité et tests

Authentification et périmètre du coach inchangés. Les métadonnées d’organisation ont une version indépendante, un verrou de fiche, une clé de commande idempotente et un journal append-only obligatoire. Une erreur de journal annule la sauvegarde. Les notes en cours restent affichées lors d’une sauvegarde de l’organisation.

Sans migration, l’accueil existant reste disponible et les nouvelles écritures d’organisation sont désactivées. Une panne de lecture de métadonnées ne fait pas silencieusement réapparaître les archives comme dossiers actifs.

Tests locaux : onboarding-crm, country, workflow, coachings, session, paid-buyers, payments et organization (scripts `*-smoke.mjs`). Ils utilisent des données fictives, sans communication ni écriture distante. `npm run deploy:check` vérifie le build et les protections de publication sans déployer.

Vérification navigateur réalisée en démonstration : agenda → fiche, modification du fuseau/lien avec conservation d’un brouillon de notes, sauvegarde des notes, archivage, restauration et réapparition dans l’agenda. Affichage testé à 390 px sans débordement horizontal.
