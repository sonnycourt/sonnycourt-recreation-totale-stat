# Contenus et attribution — première version

Branche : `codex/content-link-tracking`, départ `origin/main` c1a68c4c.
Administration : `/es-cockpit/liens/`, avec l'authentification du cockpit existant.

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
La bibliothèque affiche les 200 liens les plus récents, et le sélecteur les 500
contenus les plus récents ; un compteur signale un éventuel périmètre tronqué.
Le tableau n'affiche pas encore de revenus ni d'achats.

## Connexion et publication

`sql/marketing_links_v1.sql` est additif, réexécutable et doit être exécuté par
Sonny, puis `sql/marketing_links_publication_v2.sql` pour les métadonnées de
publication et leur modification. Respecter cet ordre lors d'une nouvelle
installation : V1 puis V2 (V2 remplace deux RPC V1). Cinq nouvelles tables
protégées par RLS ; aucune modification du schéma
MC2. Les RPC et les tables sont réservées à `service_role`. Les mêmes
variables serveur `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont utilisées.

Sur preview, le registre administrateur est réel après authentification, mais
le suivi public est désactivé. `?demo=1` n'est autorisé que hors production :
données fictives en mémoire, URLs `exemple.invalid`, aucune requête Supabase.
Les liens courts de production ne sont utilisables qu'après publication de
cette branche via le chemin de déploiement autorisé du projet.

## Prochain raccordement

- Encaissements Spiffy vérifiés, remboursements et mensualités séparés, via les
  identifiants d'inscription / clients existants. Rien n'est déduit d'un clic.
- Inscription MailerLite du guide Papa : les arrivées sont observées, mais les
  conversions de ce formulaire ne sont pas encore reliées au journal.
- Rapport des séquences (premier contact, contacts intermédiaires, dernier),
  couverture de mesure, cohortes arrivées à maturité et non-acheteurs.
- Pour les anciens contenus : remplacer seulement les liens dont on contrôle
  encore la destination. Aucune reconstruction inventée des clics historiques.
- Une bio partagée identifie un canal, pas le Short précis. Ne pas renommer sa
  source après chaque nouvelle publication.

## Vérifications

`node scripts/marketing-links-smoke.mjs` : autorisation admin, CSRF, destinations
fermées, paramètres, reçus signés, erreurs DB, consentement et isolement preview.

`scripts/marketing-links-sql-smoke.mjs` utilise un PostgreSQL WASM jetable
(PGlite installé hors dépôt), sans réseau Supabase : exécution du SQL deux fois,
droits anon/authenticated, atomicité, répétition des événements, deux contacts
pour un seul inscrit, conservation des associations sur navigateur partagé.

`scripts/marketing-links-live-read.mjs [URL_PREVIEW]` vérifie seulement le rapport
en lecture via les identifiants serveur existants, conservés en mémoire. Il ne
crée aucune donnée de test en production.

Régressions obligatoires : `test:mc2-meta-events`, `test:mc2-tracking-v2`,
`test:mc2-spiffy-checkout`, `test:mc2-replay-recovery`, `test:mc2-pay-router`.
