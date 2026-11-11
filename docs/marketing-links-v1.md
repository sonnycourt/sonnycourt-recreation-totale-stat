# Contenus et attribution — première version

Branche : `codex/content-link-tracking`, départ `origin/main` c1a68c4c.
Administration : `/link-studio/`, avec une connexion intégrée. L’ancienne adresse `/es-cockpit/liens/` redirige vers cette page.

## Utilisation

1. Nommer le contenu ; le format se préremplit selon le canal.
2. Pour une réutilisation, sélectionner ce contenu existant.
3. Choisir le canal et la destination ; générer puis copier. Les valeurs avancées
   (format, emplacement, campagne, thème, angle) restent modifiables dans « Plus de détails ».
4. Coller ce lien dans la publication / automation concernée. Aucun message n'est envoyé par cet outil.

La date de publication et l'URL du post sont facultatives. Elles peuvent être
ajoutées à la création ou après publication, depuis « Ajouter la publication » /
« Modifier la fiche ». « Voir la publication » ouvre le post dans une nouvelle
fenêtre. Modifier cette fiche ne modifie ni le lien court ni ses UTM.

Si la date de publication précède le jour de création du lien (Europe/Zurich),
le badge « Rétro » apparaît automatiquement. La date de création du lien est
affichée séparément. Les contenus non datés sont signalés : on n'en déduit pas
un suivi depuis leur première publication. Aucune vue ni vente historique n'est
reconstituée.

Le contenu conserve son identifiant. Chaque génération crée une publication et
son lien court `/r/<code>`. Les UTM sont dérivés de valeurs contrôlées et le code
stable sert de `utm_content`. Les destinations actuelles sont MC2, Delta Vision
et le guide Papa. Le canal Meta Ads vers MC2 utilise automatiquement `/meta/mc2/`
pour conserver l'attribution historique. Les `fbclid`, `ttclid`, `gclid` et
`msclkid` valides ajoutés par les plateformes passent la redirection.

Les paramètres entrants ne peuvent remplacer ni la destination ni les UTM.
Les liens publiés sont immuables dans cette V1. En cas d'erreur, créer un autre
lien. Les titres, thèmes et angles ne sont jamais envoyés à Meta par ce module.

## Mesure réellement implémentée

- Une requête de redirection n'est pas comptée : les préchargements et scanners
  d'emails ne constituent pas une visite observée.
- Le client envoie une arrivée après 1,2 seconde, uniquement si la page est
  visible. Trois essais au maximum, même identifiant. Les robots évidents sont
  ignorés, mais cette mesure ne certifie pas l'humanité de chaque visite.
- Sans consentement statistiques : aucun cookie visiteur persistant, IP,
  navigateur, URL complète, email ou téléphone n'est conservé dans ce journal.
  Un reçu signé en mémoire peut relier l'arrivée immédiate au formulaire MC2.
- Avec consentement existant : cookie propriétaire signé, HttpOnly, Secure,
  SameSite=Lax, 90 jours. Les points précédents du même navigateur peuvent être
  associés après l'inscription, sans écraser ceux déjà liés à une autre personne.
- Les associations utilisent l'inscription MC2 confirmée côté serveur, jamais
  un email ou un identifiant client proposé librement au collecteur public.
- Un retour direct avec consentement et cookie valide peut reprendre le dernier
  passage connu. Pas de rapprochement IP, d'empreinte navigateur ou de fusion
  entre appareils. Un lien partagé ne révèle pas l'identité de son expéditeur.
- L'API MC2 conserve ses règles, communications et attribution Meta. La mesure
  additionnelle expire après 900 ms ; une panne ou l'absence du SQL n'empêche pas
  l'inscription. Une mesure perdue reste une limite de couverture, pas un zéro
  de performance supposé.

Le total d'inscrits est dédupliqué. Les inscrits associés à chaque lien sont des
contributions : une même personne peut apparaître sous plusieurs liens.
La bibliothèque et le sélecteur de contenus parcourent tout l'historique, sans
plafond de résultats. La recherche et le filtre de canal sont effectués côté
serveur sur l'ensemble du registre. « Voir la suite » charge les pages suivantes
(12 liens ou 24 contenus à la fois) pour garder l'interface rapide. Les compteurs
indiquent le nombre chargé et le total correspondant à la recherche. La navigation
utilise le couple date de création / identifiant, en conservant les microsecondes,
pour ne perdre aucun résultat lorsque plusieurs éléments partagent une date.
L'onglet « Achats & parcours » affiche jusqu'aux 100 confirmations Spiffy MC2 les
plus récentes, dédupliquées par commande, hors inscriptions de test. Une fiche
dépliable relit les paiements de la commande exacte dans Spiffy : paiements
réussis, remboursements et encaissé net sont séparés du montant contractuel.
Les mensualités ne deviennent pas de nouveaux achats. Une lecture manquante
affiche « non vérifié », jamais un zéro.

La chronologie assemble les contacts explicitement associés à l'inscription,
les étapes MC2 horodatées avant la commande et le quiz enregistré avant l'achat.
Les clics ultérieurs à l'inscription du même navigateur consentant sont aussi
consultés sur 90 jours, uniquement si ce navigateur n'a qu'une identité connue
sur cette fenêtre. Les appareils partagés ou ambigus ne sont pas fusionnés.
Aucun identifiant d'accès MC2 ni identifiant navigateur ne sort vers l'interface.
Une fiche sans contact affiche « parcours non observé ». Les parcours dépassant
les limites de 500 contacts/associations sont explicitement signalés partiels.

## Connexion et publication

`sql/marketing_links_v1.sql` est additif, réexécutable et doit être exécuté par
Sonny, puis `sql/marketing_links_publication_v2.sql` pour les métadonnées de
publication et leur modification, puis `sql/marketing_links_library_v3.sql` pour
la bibliothèque complète. Respecter cet ordre lors d'une nouvelle installation :
V1, V2, V3. La V3 ajoute une RPC privée en lecture seule et deux index ; elle ne
modifie aucune donnée. L'ancienne RPC de vue d'ensemble reste disponible pour les
anciennes pages déjà ouvertes, mais la nouvelle interface ne l'utilise plus.
Cinq nouvelles tables
protégées par RLS ; aucune modification du schéma
MC2. Les RPC et les tables sont réservées à `service_role`. Les mêmes
variables serveur `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont utilisées.

Sur preview, le registre administrateur est réel après authentification, mais
le suivi public est désactivé. `?demo=1` n'est autorisé que hors production :
données fictives en mémoire, URLs `exemple.invalid`, aucune requête Supabase.
`?demo=1&volume=1` fournit 30 exemples fictifs pour vérifier la pagination.
`npm run test:marketing-library` vérifie aussi 2 500 liens et contenus sur une
base PostgreSQL locale jetable, la recherche des plus anciens, les droits privés,
les requêtes concurrentes et la reprise après une coupure réseau.
Les liens courts de production ne sont utilisables qu'après publication de
cette branche via le chemin de déploiement autorisé du projet.

## Prochain raccordement

- Étendre les parcours aux achats hors MC2 (dont Delta Vision), avec leur propre
  identité de conversion confirmée. Rien n'est déduit d'un clic.
- Inscription MailerLite du guide Papa : les arrivées sont observées, mais les
  conversions de ce formulaire ne sont pas encore reliées au journal.
- Comparaison agrégée des séquences acheteurs / non-acheteurs et des cohortes
  arrivées à maturité, sur des périodes de suivi équivalentes.
- Pour les anciens contenus : remplacer seulement les liens dont on contrôle
  encore la destination. Aucune reconstruction inventée des clics historiques.
- Une bio partagée identifie un canal, pas le Short précis. Ne pas renommer sa
  source après chaque nouvelle publication.

## Vérifications

`node scripts/marketing-links-smoke.mjs` : autorisation admin, CSRF, destinations
fermées, paramètres, reçus signés, erreurs DB, consentement et isolement preview.

`node scripts/marketing-journeys-smoke.mjs` : parcours après inscription,
appareil partagé, exclusions de test, confidentialité, déduplication des commandes
et paiements, remboursements, panne prestataire et badge rétro.

`scripts/marketing-links-sql-smoke.mjs` utilise un PostgreSQL WASM jetable
(PGlite installé hors dépôt), sans réseau Supabase : exécution du SQL deux fois,
droits anon/authenticated, atomicité, répétition des événements, deux contacts
pour un seul inscrit, conservation des associations sur navigateur partagé.

`scripts/marketing-links-live-read.mjs [URL_PREVIEW]` vérifie seulement le rapport
en lecture via les identifiants serveur existants, conservés en mémoire. Il ne
crée aucune donnée de test en production.

Régressions obligatoires : `test:mc2-meta-events`, `test:mc2-tracking-v2`,
`test:mc2-spiffy-checkout`, `test:mc2-replay-recovery`, `test:mc2-pay-router`.

## Connexion Link Studio

- L’interface reste visible sans connexion ; aucune donnée du registre ni des acheteurs n’est livrée sans session valide.
- Même mot de passe que le cockpit ES2 (`admin_es2_auth`), sans copie ni modification du hash. Cookie distinct `__Host-link_studio`, limité à cette application, HttpOnly, Secure, SameSite=Strict, 30 jours fixes. Aucun mot de passe dans localStorage. Modifier le mot de passe du cockpit invalide aussi ces sessions.
- Trois vérifications de mot de passe maximum par adresse IP sur une heure glissante (y compris une tentative correcte). L’adresse fiable vient du contexte Netlify, jamais des en-têtes envoyés par le navigateur. Un HMAC de l’IP sert de clé, seuls les trois horodatages sont stockés.
- Réservation atomique dans Netlify Blobs avant bcrypt : lecture forte + `onlyIfNew` / `onlyIfMatch`. Si le stockage est indisponible, connexion refusée temporairement (503). Le quota persiste entre instances et déploiements ; il n’est pas remis à zéro en rechargeant la page. Les réseaux partagés partagent ce quota.
- La compatibilité v10 reprend la correction officielle Netlify #820 via un adaptateur fetch : un conflit HTTP 409 vaut refus de réservation, les autres erreurs ne sont jamais un succès. Vérification réelle sur un stockage de test : 20 requêtes concurrentes, 3 réservations et 17 refus ; données de test supprimées.
- La dépendance moderne est isolée sous l’alias `@netlify/blobs-auth` ; les autres fonctions gardent leur version existante. Aucune modification Supabase requise.
- Déconnexion disponible dans la barre supérieure ; suppression du cookie sur cet appareil. Les API marketing n’acceptent plus le cookie du cockpit.
- Tests : `node scripts/marketing-auth-smoke.mjs`, `node scripts/marketing-links-smoke.mjs`, `node scripts/marketing-journeys-smoke.mjs`. Le premier couvre notamment 20 tentatives parallèles : seulement trois comparaisons de mot de passe.
