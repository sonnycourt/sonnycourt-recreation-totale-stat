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
- les crédits expirés sont exclus du solde et le cycle expirant le plus tôt est
  consommé en priorité ;
- une annulation ne restitue un crédit que si cette séance l'avait réellement
  débité : une séance manuelle ne peut pas fabriquer de solde ;
- webhooks et remboursements idempotents ;
- un remboursement annule les rendez-vous futurs concernés, libère les
  créneaux et supprime leurs événements Google Calendar ;
- jetons Google chiffrés en AES-256-GCM côté serveur ;
- liens d'activation stockés uniquement sous forme de hash et valables 48 heures.
- aucun visiteur Google SSO ne reçoit de rôle ni ne crée de dossier si son
  email ne correspond pas déjà à un achat ou une invitation.
- si ce visiteur achète ensuite, la commande rattache automatiquement son
  compte Google existant au dossier client sans générer de lien inutilisable ;
- l’identité affichée dans les espaces coach et élève provient du coach assigné
  (`nom` et `avatar_url`) : le socle n’est pas limité à Romain.

`sql/coach_diagnostic.sql` reste séparé pour le tunnel historique de première
consultation à 97 €. Rien n'est supprimé pendant la transition.

## Paiement et compte client

Le webhook `coach-spiffy-webhook` :

1. refuse tout appel non authentifié (signature ou token privé) ;
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
- `SPIFFY_FIRST_CONSULTATION_IDS` (`39602` pour la checkout actuelle)
- `COACHING_SPIFFY_WEBHOOK_TOKEN` (secret aléatoire long, distinct des autres)

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
L'identifiant Google de l'événement est déterministe : une relance ne crée pas
de doublon. Les emails client et coach sont également dédupliqués par séance.

Variables :

- `GOOGLE_COACHING_CLIENT_ID`
- `GOOGLE_COACHING_CLIENT_SECRET`
- `COACHING_TOKEN_ENCRYPTION_KEY` (secret long et stable)
- `COACHING_SYNC_SECRET` (pour une future synchronisation planifiée)

L'URI OAuth autorisée est :

`https://sonnycourt.com/.netlify/functions/coaching-google-callback`

Google SSO pour la connexion des utilisateurs est un réglage séparé dans
Supabase Auth. Ajouter les redirects `/coaching/auth/callback` de production et
de localhost, ainsi que `/coaching/reset-password` pour la récupération du mot
de passe.

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
  remboursements idempotents, ainsi que le cas Google SSO avant achat ;
- `npm run test:coaching-functions` vérifie que les fonctions refusent les
  appels non configurés/non authentifiés, la signature Spiffy, sa limite de
  fraîcheur et le chiffrement des jetons Google ;
- `npm run test:coaching-frontend` garantit la présence des trois routages de
  rôle, de l'email/mot de passe, de Google SSO et de la récupération, ainsi que
  l'absence de magic links ;
- `npm run build` construit les 270 pages.
- `npm run check:coaching-readiness` vérifie la présence, la cohérence et le
  format de chaque variable externe sans jamais afficher sa valeur.

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
6. Créer/renseigner les trois checkouts Spiffy et leur webhook protégé.
7. Faire un achat test, une réservation, un déplacement et un remboursement.

Configurer MailerSend **avant** d’activer les webhooks Spiffy. Si une livraison
d’email échoue après l’achat, Spiffy peut rejouer le webhook : le système ne
recrédite pas la commande, invalide l’ancien lien et en délivre un nouveau.

Webhooks Spiffy à renseigner dans les automatisations correspondantes :

- achat : `https://sonnycourt.com/.netlify/functions/coach-spiffy-webhook?event=purchase&token=SECRET`
- remboursement : `https://sonnycourt.com/.netlify/functions/coach-spiffy-webhook?event=refund&token=SECRET`

Le paramètre est volontaire : les Custom Webhooks Spiffy héritent du contexte
de l’automatisation mais ne fournissent pas toujours un nom d’événement dans le
corps. Le serveur refuse donc les événements ambigus et les commandes échouées.
Il ne conserve pas le corps complet (adresse, téléphone ou données de carte
partielles), seulement quelques identifiants techniques d’audit.

`SECRET` doit être exactement la valeur de `COACHING_SPIFFY_WEBHOOK_TOKEN`.
Spiffy n’envoie pas systématiquement les en-têtes Svix observés sur d’autres
providers ; le serveur accepte donc soit une signature valide, soit ce token
privé, mais jamais un appel dépourvu des deux.

Le pont qui transforme aussi le paiement historique de la première
consultation à 97 € en dossier/séance Coaching OS et en email d'activation
reste volontairement désactivé jusqu'à l'autorisation explicite de Sonny. Les
packs 1, 3 et 6 séances utilisent déjà le flux Coaching OS.

Le centre de suivi du coach est branché à `coaching_actions` : création d'une
action interne liée à un client, échéance, priorité, clôture et réouverture. Ces
actions restent privées au coach assigné grâce aux règles RLS. Elles ne
déclenchent volontairement aucun email ni rappel automatique.

## Décisions commerciales encore modifiables

- séance de suivi à 60 minutes actuellement ;
- validités : 1 séance 90 jours, 3 séances 120 jours, 6 séances 240 jours ;
- aucune règle de pénalité pour annulation tardive à ce stade ;
- questionnaire requis avant chaque nouvelle réservation ;
- 247 €, 591 € et 882 € définis dans la migration et la page.
