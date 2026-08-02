# Coaching OS — état de livraison et activation

## Résultat livré

Le système fonctionne en deux modes sans toucher aux funnels existants :

- sur `localhost`, une démonstration complète repose sur `localStorage` ;
- avec `?live=1` ou sur le domaine, les mêmes écrans utilisent Supabase.

Entrées principales :

- `/coaching` : connexion email + mot de passe, Google SSO et récupération ;
- `/coaching/admin` : supervision propriétaire ;
- `/coach-console` : espace isolé du coach ;
- `/coaching/eleve` : espace du client ;
- `/coaching/preparation` → `/coaching/reserver` → `/coaching/confirmation` ;
- `/coach-romain/continuer` : offres 1, 3 et 6 séances ;
- `/coaching/activer` : création du mot de passe après un premier achat.

## Couche métier

La migration additive `sql/coaching_platform.sql` crée les profils, rôles,
clients, offres, engagements, crédits, disponibilités, séances, formulaires,
notes privées, actions, commandes, activations et connexions Google.

Garanties importantes :

- toutes les tables utilisent le préfixe `coaching_` ;
- RLS sur chaque table ;
- rôle stocké dans `coaching_memberships`, jamais approuvé depuis les métadonnées utilisateur ;
- un coach ne lit que ses clients ;
- un client ne lit que son dossier ;
- les notes privées ne sont lisibles que par leur coach, pas par le propriétaire ;
- crédits dans un journal append-only ;
- réservation atomique d'un créneau et d'un crédit ;
- webhooks et remboursements idempotents ;
- jetons Google chiffrés en AES-256-GCM côté serveur ;
- liens d'activation stockés uniquement sous forme de hash et valables 48 heures.
- aucun visiteur Google SSO ne reçoit de rôle ni ne crée de dossier si son
  email ne correspond pas déjà à un achat ou une invitation.

`sql/coach_diagnostic.sql` reste séparé pour le tunnel historique de première
consultation à 97 €. Rien n'est supprimé pendant la transition.

## Paiement et compte client

Le webhook `coach-spiffy-webhook` :

1. refuse tout appel non signé ;
2. conserve la logique de la première consultation existante ;
3. reconnaît les checkouts 1, 3 et 6 séances ;
4. crée ou rattache le client ;
5. ajoute les crédits une seule fois ;
6. envoie, pour un nouveau client, un lien d'activation du mot de passe ;
7. retire les crédits lors d'un remboursement.

Les trois URLs de checkout sont injectées avec :

- `PUBLIC_SPIFFY_COACHING_SESSION_1_URL`
- `PUBLIC_SPIFFY_COACHING_PACK_3_URL`
- `PUBLIC_SPIFFY_COACHING_PACK_6_URL`

Les identifiants reconnus par le webhook sont configurés avec :

- `SPIFFY_COACHING_SESSION_1_IDS`
- `SPIFFY_COACHING_PACK_3_IDS`
- `SPIFFY_COACHING_PACK_6_IDS`

Variables Supabase nécessaires aux fonctions serveur :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY` (ou l'ancien `SUPABASE_ANON_KEY`)
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Google Calendar et Meet

Le coach clique sur « Connecter Google » dans sa configuration. L'OAuth stocke
ses jetons chiffrés. « Synchroniser » transforme ses règles de disponibilité
en créneaux, en retirant les périodes occupées dans Google Calendar. Après une
réservation, l'événement et le lien Meet sont créés puis envoyés aux participants.

Variables :

- `GOOGLE_COACHING_CLIENT_ID`
- `GOOGLE_COACHING_CLIENT_SECRET`
- `COACHING_TOKEN_ENCRYPTION_KEY` (secret long et stable)
- `COACHING_SYNC_SECRET` (pour une future synchronisation planifiée)

L'URI OAuth autorisée est :

`https://sonnycourt.com/.netlify/functions/coaching-google-callback`

Google SSO pour la connexion des utilisateurs est un réglage séparé dans
Supabase Auth. Ajouter les redirects `/coaching/auth/callback` de production et
de localhost.

## Emails

La confirmation de réservation et le lien d'activation utilisent MailerSend si
ces variables sont présentes :

- `MAILERSEND_API_KEY`
- `COACHING_EMAIL_FROM`
- `COACHING_EMAIL_FROM_NAME`

Les rappels récurrents ne sont volontairement pas activés : leur activation
nécessite une validation explicite car ils transmettent automatiquement des
données personnelles et des liens Meet à MailerSend.

## Vérifications automatisées

Ces commandes ne contactent aucun client et n'écrivent dans aucun service réel :

- `npm run test:coaching-db` installe les deux migrations dans un PostgreSQL
  isolé et teste les rôles, les accès croisés interdits, la première
  consultation, les crédits, les réservations, annulations, achats et
  remboursements idempotents ;
- `npm run test:coaching-functions` vérifie que les fonctions refusent les
  appels non configurés/non authentifiés, la signature Spiffy, sa limite de
  fraîcheur et le chiffrement des jetons Google ;
- `npm run build` construit les 270 pages.

Résultat local au 2 août 2026 : tous ces tests passent. Le sas de publication
signale volontairement un seul changement métier à approuver : la page
`/coach-romain/` ne dit plus que les créneaux « ouvriront prochainement », car
elle permet maintenant de réserver. Ne pas modifier la liste des routes
critiques sans validation explicite de Sonny.

## Activation restante

1. Autoriser l'écriture Supabase puis appliquer `sql/coach_diagnostic.sql` et
   `sql/coaching_platform.sql` dans cet ordre.
2. Créer les comptes Sonny et Romain dans Supabase Auth.
3. Attribuer les rôles avec la fonction serveur :
   - `coaching_assign_role_by_email('email-sonny', 'owner', null)`
   - `coaching_assign_role_by_email('email-romain', 'coach', 'romain')`
4. Ajouter les plages de Romain dans `coaching_availability_rules`.
5. Renseigner les variables Google, Spiffy et MailerSend ci-dessus.
6. Créer/renseigner les trois checkouts Spiffy et leur webhook signé.
7. Faire un achat test, une réservation, un déplacement et un remboursement.

Webhook Spiffy à renseigner :

`https://sonnycourt.com/.netlify/functions/coach-spiffy-webhook`

Le pont qui transforme aussi le paiement historique de la première
consultation à 97 € en dossier/séance Coaching OS et en email d'activation
reste volontairement désactivé jusqu'à l'autorisation explicite de Sonny. Les
packs 1, 3 et 6 séances utilisent déjà le flux Coaching OS.

## Décisions commerciales encore modifiables

- séance de suivi à 60 minutes actuellement ;
- validités : 1 séance 90 jours, 3 séances 120 jours, 6 séances 240 jours ;
- aucune règle de pénalité pour annulation tardive à ce stade ;
- questionnaire requis avant chaque nouvelle réservation ;
- 247 €, 591 € et 882 € définis dans la migration et la page.
