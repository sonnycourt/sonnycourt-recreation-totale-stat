# Espace Coaching — feuille de route Supabase

Ce document accompagne la maquette `/coach-console?preview=1`. La maquette
n'écrit aucune donnée distante : les quelques brouillons de notes sont stockés
uniquement dans le navigateur pour démontrer l'expérience.

## Principe directeur

Une seule plateforme peut accueillir Romain puis d'autres coachs si chaque
objet métier possède une identité stable et si l'accès est filtré au niveau de
la base, pas seulement dans l'interface.

- `coach_id` détermine qui peut consulter le dossier.
- `client_id` représente une personne indépendamment de ses achats successifs.
- `engagement_id` représente un accompagnement ou un cycle de coaching.
- `session_id` représente un rendez-vous précis.
- Les notes sont minimales, privées et séparées des données commerciales.
- Sonny conserve un rôle propriétaire ; un coach ne voit que les clients qui
  lui sont assignés.

## Tables proposées

### `coach_profiles`

Profil de travail relié à `auth.users` : nom, slug, photo, fuseau horaire,
statut actif, identifiant du calendrier Google et rôle (`coach`, `owner`).

### `coaching_clients`

Identité normalisée du client : prénom, nom, email normalisé, téléphone, pays,
consentements et date de création. L'email sert au rapprochement initial avec
Spiffy, mais l'identité interne reste un UUID.

### `coaching_engagements`

Relation entre un client et un coach : type d'offre, date de début, état
(`lead`, `consultation`, `active`, `paused`, `completed`, `cancelled`), nombre
de séances prévu et objectif courant.

### `coaching_sessions`

Rendez-vous : coach, client, engagement, début, fin, fuseau horaire, statut,
lien Google Meet, identifiant Google Calendar, réservation source et paiement
source. Une contrainte empêche deux séances actives sur le même créneau.

### `coaching_intake_responses`

Réponses au formulaire post-paiement : priorité, contexte libre, version du
formulaire et date d'envoi. La version permet de faire évoluer les questions
sans rendre les anciennes réponses ambiguës.

### `coaching_session_notes`

Note privée du coach : intention, observations essentielles, décision,
engagement, point à reprendre, état du brouillon et auteur. Conserver ici le
minimum réellement utile ; ne pas stocker de diagnostic médical ou de détails
intimes sans nécessité claire.

### `coaching_actions`

Tâches liées à un client, une séance ou un engagement : titre, échéance,
priorité, état, origine (`manual`, `automation`) et personne responsable.

### `coaching_activity_log`

Journal append-only des changements importants : attribution d'un client,
consultation d'une note, changement de rendez-vous, remboursement, export ou
suppression. Utile pour la sécurité et la compréhension des incidents.

### Packs, commandes et crédits

Le portail élève nécessite aussi un catalogue d'offres, les commandes Spiffy et
un journal de crédits append-only. Le détail des tables `coaching_offers`,
`coaching_orders`, `coaching_credit_ledger`, `coaching_memberships` et
`coaching_form_templates` se trouve dans `coaching-system-handoff.md`.

## Connexion avec l'existant

Les tables actuelles `coach_diagnostic_slots` et
`coach_diagnostic_bookings` ne doivent pas être supprimées pendant la
transition.

1. Ajouter facultativement `client_id`, `engagement_id` et `session_id` à la
   réservation existante.
2. À la confirmation Spiffy, rechercher un client par email normalisé, le créer
   si nécessaire puis créer la séance.
3. Conserver le `public_token` actuel pour la page de confirmation, sans
   l'utiliser comme autorisation dans le CRM.
4. Migrer le vocabulaire visible de « diagnostic » vers « première
   consultation » sans renommer brutalement les tables ou fonctions déjà en
   service.

## Règles d'accès indispensables

- RLS activée sur toutes les tables de coaching.
- Un coach authentifié peut lire les clients reliés à ses engagements actifs.
- Un coach peut écrire seulement ses propres notes et actions.
- Une note de séance ne doit jamais être renvoyée à une page publique.
- Le rôle propriétaire peut superviser les coachs et réattribuer un dossier.
- Le webhook Spiffy utilise uniquement la clé service côté serveur.
- Les jetons Google ne sont jamais exposés au navigateur ; ils sont chiffrés ou
  conservés dans un gestionnaire de secrets côté serveur.

## Flux cible après paiement

1. Spiffy confirme le paiement et transmet le token de réservation.
2. Le webhook valide la signature puis marque la réservation comme payée.
3. Supabase rapproche ou crée le client.
4. L'engagement « première consultation » et la séance sont créés.
5. Google Calendar crée l'événement et le lien Meet.
6. L'email de confirmation contient la date, le lien Meet et le questionnaire.
7. La réponse au questionnaire apparaît immédiatement dans le dossier du coach.
8. Après la séance, une action « finaliser la note » est créée automatiquement.

## Ordre de mise en œuvre

1. Faire valider la maquette et le niveau de détail des notes par Romain.
2. Créer les tables, index et politiques RLS dans un environnement de test.
3. Ajouter l'authentification coach et propriétaire.
4. Brancher la lecture seule du tableau de bord.
5. Brancher les notes et actions avec journal d'activité.
6. Relier le webhook Spiffy aux clients et séances.
7. Ajouter Google Calendar et Google Meet.
8. Tester paiement, doublon d'email, annulation, remboursement, changement de
   coach et suppression de compte.
9. Ouvrir à Romain, observer son usage, puis seulement généraliser à un second
   coach.

## Critères avant production

- Aucun dossier d'un coach n'est visible par un autre lors des tests RLS.
- Un double webhook Spiffy ne crée pas deux clients ou deux séances.
- Une annulation libère correctement le créneau.
- Les brouillons ne sont jamais perdus silencieusement.
- Les dates sont cohérentes entre le fuseau du client et celui du coach.
- Un export et une suppression des données client sont possibles.
- Les logs ne contiennent ni note privée ni donnée de carte bancaire.
