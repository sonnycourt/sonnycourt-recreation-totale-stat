# Coaching OS — état de livraison et activation

## Résultat livré

Le système fonctionne en deux modes sans toucher aux funnels existants :

- sur `localhost`, une démonstration complète repose sur `localStorage` ;
- avec `?live=1` ou sur le domaine, les mêmes écrans utilisent Supabase.

Les pages publiques d'acquisition restent sur `sonnycourt.com`. L'application
privée est servie depuis `https://coaching.sonnycourt.com` :

- `/` : connexion email + mot de passe et récupération ;
- `/admin` : supervision propriétaire ;
- `/coach` : espace isolé du coach ;
- `/eleve` : espace du client ;
- `/credits` : wallet, memberships et recharges ;
- `/compte` : identité, photo et préférences de chaque rôle ;
- `/preparation` → `/reserver` → `/confirmation` ;
- `/coach-romain/continuer` : offres 1, 3 et 6 séances ;
- `/activer` : création du mot de passe après un premier achat.

Les anciennes routes `/coaching/*` et `/coach-console` sur `sonnycourt.com`
redirigent vers le sous-domaine. Le code source historique reste en place : les
routes propres du sous-domaine sont des rewrites Netlify, sans duplication des
écrans ni des données.

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
- aucun visiteur ne peut créer un dossier sans achat ou invitation préalable ;
- l’identité affichée dans les espaces coach et élève provient du coach assigné
  (`nom` et `avatar_url`) : le socle n’est pas limité à Romain.

La migration additive `sql/coaching_wallet_memberships.sql` fait évoluer le
modèle vers une unité simple : **1 crédit = 15 minutes**. Une séance standard
de 45 minutes consomme donc 3 crédits. Elle ajoute les memberships, le suivi
des rémunérations coach et de leurs bonus qualité, le feedback client et la
mise à jour sécurisée des profils. Les crédits sont débités du cycle qui expire
le plus tôt et une annulation restitue exactement les poches débitées.

`sql/coaching_profile_storage.sql` crée uniquement le bucket d'avatars et ses
politiques d'accès : un utilisateur peut modifier son propre dossier, sans
accès en écriture à celui des autres.

`sql/coach_diagnostic.sql` reste séparé pour le tunnel historique de première
consultation à 97 €. Rien n'est supprimé pendant la transition.

`sql/coaching_unified_availability.sql` unifie l'agenda sur des unités internes
de 15 minutes. La première consultation reste fixe à 45 minutes ; les suivis
peuvent durer 30, 45, 60 ou 90 minutes sans risque de chevauchement.

## Paiement et compte client

Le webhook `coach-spiffy-webhook` :

1. refuse tout appel non authentifié (signature ou token privé) ;
2. conserve la logique de la première consultation existante ;
3. reconnaît les recharges de 3, 9 et 18 crédits, les trois memberships et la formule ES2 Complet ;
4. crée ou rattache le client ;
5. ajoute les crédits une seule fois ;
6. envoie, pour un nouveau client, un lien d'activation du mot de passe ;
7. retire les crédits lors d'un remboursement.

Les trois URLs de checkout sont injectées avec :

- `PUBLIC_SPIFFY_COACHING_SESSION_1_URL=https://sonnycourt.spiffy.co/checkout/coaching-romain-1-seance`
- `PUBLIC_SPIFFY_COACHING_PACK_3_URL=https://sonnycourt.spiffy.co/checkout/coaching-romain-pack-3`
- `PUBLIC_SPIFFY_COACHING_PACK_6_URL=https://sonnycourt.spiffy.co/checkout/coaching-romain-pack-6`
- `PUBLIC_SPIFFY_COACHING_MEMBERSHIP_3_URL` (à renseigner après création)
- `PUBLIC_SPIFFY_COACHING_MEMBERSHIP_6_URL` (à renseigner après création)
- `PUBLIC_SPIFFY_COACHING_MEMBERSHIP_12_URL` (à renseigner après création)

Les identifiants reconnus par le webhook sont configurés avec :

- `SPIFFY_COACHING_SESSION_1_IDS=39609`
- `SPIFFY_COACHING_PACK_3_IDS=39610`
- `SPIFFY_COACHING_PACK_6_IDS=39611`
- `SPIFFY_COACHING_MEMBERSHIP_3_IDS` (à renseigner)
- `SPIFFY_COACHING_MEMBERSHIP_6_IDS` (à renseigner)
- `SPIFFY_COACHING_MEMBERSHIP_12_IDS` (à renseigner)
- `SPIFFY_ES2_COMPLETE_IDS` (identifiants Spiffy des checkouts ES2 Complet comptant et 12 fois)
- `SPIFFY_FIRST_CONSULTATION_IDS` (`39602` pour la checkout actuelle)
- `COACHING_SPIFFY_WEBHOOK_TOKEN` (secret aléatoire long, distinct des autres)

Variables Supabase nécessaires aux fonctions serveur :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PUBLISHABLE_KEY` (ou l'ancien `SUPABASE_ANON_KEY`)
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `COACHING_APP_ORIGIN=https://coaching.sonnycourt.com`

## Google Calendar et Meet

Le coach clique sur « Connecter Google » dans sa configuration. L'OAuth stocke
ses jetons chiffrés. « Enregistrer et publier » transforme ses plages libres
en créneaux, en retirant les périodes occupées dans Google Calendar. La
synchronisation est ensuite rejouée automatiquement toutes les 15 minutes.
Après une réservation, l'événement et le lien Meet sont créés puis envoyés aux participants.
L'identifiant Google de l'événement est déterministe : une relance ne crée pas
de doublon. Les emails client et coach sont également dédupliqués par séance.

Variables :

- `GOOGLE_COACHING_CLIENT_ID`
- `GOOGLE_COACHING_CLIENT_SECRET`
- `COACHING_TOKEN_ENCRYPTION_KEY` (secret long et stable)
- `COACHING_SYNC_SECRET` (synchronisation planifiée)

L'URI OAuth Google Calendar autorisée est :

`https://coaching.sonnycourt.com/.netlify/functions/coaching-google-callback`

Le `Site URL` Supabase Auth doit être `https://coaching.sonnycourt.com`. Ajouter
`https://coaching.sonnycourt.com/reset-password` aux redirects autorisés, tout
en conservant temporairement les URLs localhost pour les tests.

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

- `npm run test:coaching-db` installe les migrations métier dans un PostgreSQL
  isolé et teste les rôles, les accès croisés interdits, la première
  consultation, les crédits, les réservations, annulations, achats et
  remboursements idempotents et les durées variables ;
- `npm run test:coaching-functions` vérifie que les fonctions refusent les
  appels non configurés/non authentifiés, la signature Spiffy, sa limite de
  fraîcheur et le chiffrement des jetons Google ;
- `npm run test:coaching-frontend` garantit la présence des trois routages de
  rôle, de l'email/mot de passe et de la récupération, ainsi que l'absence de
  Google SSO et de magic links ;
- `npm run build` construit les 273 pages.
- `npm run check:coaching-readiness` vérifie la présence, la cohérence et le
  format de chaque variable externe sans jamais afficher sa valeur.

Résultat local au 2 août 2026 : tous ces tests passent. Le sas de publication
signale volontairement un seul changement métier à approuver : la page
`/coach-romain/` ne dit plus que les créneaux « ouvriront prochainement », car
elle permet maintenant de réserver. Ne pas modifier la liste des routes
critiques sans validation explicite de Sonny.

## Activation restante

1. Ajouter `coaching.sonnycourt.com` comme alias du site Netlify et faire pointer
   le DNS vers ce même site ; le domaine principal reste `sonnycourt.com`.
2. Définir `COACHING_APP_ORIGIN=https://coaching.sonnycourt.com` dans Netlify.
3. Mettre à jour les URLs Supabase Auth et l'URI OAuth Google ci-dessus.
4. Autoriser l'écriture Supabase puis appliquer, dans cet ordre :
   `sql/coach_diagnostic.sql`, `sql/coaching_platform.sql`,
   `sql/coaching_first_consultation_bridge.sql`,
   `sql/coaching_wallet_memberships.sql`, puis
   `sql/coaching_session_reviews.sql`, `sql/coaching_stripe.sql`,
   `sql/coaching_profile_storage.sql` et enfin
   `sql/coaching_unified_availability.sql`.
5. Créer les comptes Sonny et Romain dans Supabase Auth.
6. Attribuer les rôles avec la fonction serveur :
   - `coaching_assign_role_by_email('email-sonny', 'owner', null)`
   - `coaching_assign_role_by_email('email-romain', 'coach', 'romain')`
7. Ajouter les plages de Romain dans `coaching_availability_rules`.
8. Renseigner les variables Google, Spiffy et MailerSend ci-dessus.
9. Créer/renseigner les trois recharges et les trois memberships Spiffy, puis
   brancher leur webhook protégé.
10. Configurer le retour de checkout Spiffy vers
    `https://coaching.sonnycourt.com/achat-confirme` puis faire un achat test,
    une réservation, un déplacement et un remboursement.

Configurer MailerSend **avant** d’activer les webhooks Spiffy. Si une livraison
d’email échoue après l’achat, Spiffy peut rejouer le webhook : le système ne
recrédite pas la commande, invalide l’ancien lien et en délivre un nouveau.

Webhooks Spiffy à renseigner dans les automatisations correspondantes :

- achat : `https://sonnycourt.com/.netlify/functions/coach-spiffy-webhook?event=purchase&token=SECRET`
- remboursement : `https://sonnycourt.com/.netlify/functions/coach-spiffy-webhook?event=refund&token=SECRET`

Pour les deux checkouts de la formule ES2 Complet, utiliser les mêmes URLs en
ajoutant `&offer=es2-complete-coaching`. Le paiement crée ou rattache le compte,
ajoute exactement 12 crédits et marque leur origine « ES2 Complet ». Lorsqu'un
identifiant de souscription est présent, il sert de clé stable afin qu'une
échéance du paiement en 12 fois ne recrédite jamais le client.

Le paramètre est volontaire : les Custom Webhooks Spiffy héritent du contexte
de l’automatisation mais ne fournissent pas toujours un nom d’événement dans le
corps. Le serveur refuse donc les événements ambigus et les commandes échouées.
Il ne conserve pas le corps complet (adresse, téléphone ou données de carte
partielles), seulement quelques identifiants techniques d’audit.

`SECRET` doit être exactement la valeur de `COACHING_SPIFFY_WEBHOOK_TOKEN`.
Spiffy n’envoie pas systématiquement les en-têtes Svix observés sur d’autres
providers ; le serveur accepte donc soit une signature valide, soit ce token
privé, mais jamais un appel dépourvu des deux.

Le pont qui transforme le paiement historique de la première consultation à
97 € en dossier, séance Coaching OS et email d'activation a été autorisé par
Sonny le 2 août 2026. Il est installé par
`sql/coaching_first_consultation_bridge.sql`. Un paiement reçu après
expiration du créneau crée le dossier et le crédit, mais place la séance en
revue au lieu de réserver un horaire potentiellement repris. Les packs 1, 3 et
6 séances utilisent le même flux Coaching OS.

Le centre de suivi du coach est branché à `coaching_actions` : création d'une
action interne liée à un client, échéance, priorité, clôture et réouverture. Ces
actions restent privées au coach assigné grâce aux règles RLS. Elles ne
déclenchent volontairement aucun email ni rappel automatique.

## Économie installée, encore modifiable

- 1 crédit = 15 minutes ; séance de suivi standard = 3 crédits / 45 minutes ;
- validités : 1 séance 90 jours, 3 séances 120 jours, 6 séances 240 jours ;
- memberships : 3 crédits à 177 €, 6 à 318 €, 12 à 588 € par mois, reportables 90 jours ;
- rémunération coach par défaut : 25 € par crédit livré, bonus qualité plafonné
  à 5 € par crédit ; première consultation à 48,50 € pour le coach ;
- aucune règle de pénalité pour annulation tardive à ce stade ;
- questionnaire requis avant chaque nouvelle réservation ;
- 247 €, 591 € et 882 € définis dans la migration et la page.
