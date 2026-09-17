# CRM onboarding — espace indépendant

URL cible : `/onboarding/`. Démonstration : `/onboarding/?demo=1` (données fictives, en mémoire seulement).

## Périmètre

- Nouveau portail privé, API et trois tables dédiées : `onboarding_staff`, `onboarding_cases`, `onboarding_events`.
- Connexion avec les identifiants closer existants. L'autorisation onboarding est distincte : Romain (coach, attribution par défaut) et Sonny (propriétaire). Aucun droit ajouté aux autres closers.
- Exception de mot de passe lisible demandée ensuite pour Romain : voir `romain-readable-password.md`. Le compte et ses autorisations ne changent pas.
- Aucune modification de `/coach/`, de la plateforme coaching, du CRM closer, des pages MC2, du tracking ou des webhooks de paiement.
- Aucun envoi automatique de SMS, d'email ou de WhatsApp. Copier un exemple / noter un envoi est différent d'envoyer un message.
- Les rendez-vous sont des repères internes, pas des événements Google Calendar ni des réservations de la plateforme coaching.

## Arrivée des dossiers

L'API synchronise au chargement et toutes les 60 secondes quand l'onglet est visible. Les achats sont donc visibles au prochain rafraîchissement ; quand le CRM est fermé, le rattrapage se fait à sa réouverture. Aucun cron, aucun trigger greffé sur un achat.

Source : `mc2_registrations`, achat confirmé (`purchased_at`, `statut = purchased`), démarrage à zéro et l'un des modes `spiffy_j7_12x197` / `spiffy_j7_6x347`.

- Import unique par email normalisé ; l'achat le plus ancien est retenu. Un second achat de la même personne ne crée pas un second dossier d'accueil.
- Exclusions : table de tests MC2, email de test confirmé Demariae, noms marqués « test », emails sandbox/example.com.
- Mise à jour des coordonnées après complétion de facturation. Jamais d'écrasement des notes, de l'attribution, des préférences de nom ou de l'avancement.
- Si l'import échoue, les dossiers précédents restent lisibles avec un avertissement explicite ; aucune perte silencieuse.
- Des notes prises avant ce CRM dans des documents libres ne sont pas inventées/importées automatiquement. Le coach peut les reporter.

## Suivi

Un bouton « Noter une prise de contact » ouvre une fenêtre avec scénario, date/heure locale préremplie et note facultative. La date est modifiable rétrospectivement ; le serveur rejette les dates futures (tolérance de 5 minutes pour le décalage d'horloge). Aucun bouton ou lien ne déclenche d'appel.

Appel sans réponse → SMS à envoyer maintenant. SMS **réellement envoyé manuellement**, marqué par le coach → rappel WhatsApp à +24 heures **de l'envoi déclaré**, pas de la saisie. Vocal enregistré → suite à décider, sans relance répétitive automatique. Un contact établi efface le rappel de non-réponse. Une saisie antérieure à une action plus récente ne remplace pas sa progression. Dossier en pause : ne pas relancer.

Scénarios : appel sans réponse, appel avec réponse, SMS envoyé, vocal WhatsApp envoyé, réponse reçue par message, numéro injoignable, onboarding réalisé, note libre.

Une entrée peut être supprimée par son auteur ou le propriétaire, après confirmation. La suppression est un archivage privé réversible (`deleted_at`, `deleted_by`) : la fiche, ses notes, rendez-vous et son état ne sont pas effacés ni annulés. Les reprises réseau ne recréent pas une entrée supprimée. L'heure réelle du contact et l'heure d'enregistrement sont conservées séparément.

Notes privées : objectif, motivations, freins, routine, notes libres. Trois cases : accès formation et communauté (un seul contrôle qui synchronise les deux anciens champs), feedback J+14 expliqué, premier coaching agendé. Choisir une date de coaching coche le dernier repère sans envoyer d'invitation. Historique daté des 100 dernières actions non supprimées affiché ; tout l'historique est conservé en base. Liste paginée par 50, recherche nom/email/téléphone/pays/ville, compteurs calculés sur tous les dossiers autorisés.

J+14 et J+33 sont calculés depuis la date civile d'achat à Paris (changement d'heure testé). Les saisies d'heures de rendez-vous sont dans le fuseau de l'appareil, indiqué à l'écran. Le serveur refuse un coaching antérieur à J+33. Une date d'onboarding renseignée propose le statut « planifié » et un rappel interne à ce moment.

## Connexion persistante

Adresse officielle : `https://sonnycourt.com/onboarding/`. Le login existant émet le cookie signé `closer_access` avec `Max-Age=2592000` (30 jours), HttpOnly, Secure en HTTPS, SameSite=Lax et Path=/. La session est relue automatiquement au chargement et survit aux rafraîchissements ; aucune copie du mot de passe n'est stockée dans le navigateur par le CRM. Les aperçus Netlify ont des domaines distincts et ne partagent pas ce cookie.

La déconnexion expire le cookie de ce navigateur. Un compte désactivé est refusé même avant l'expiration ; après 30 jours, une nouvelle connexion est nécessaire. La suppression des cookies, la navigation privée et les autres appareils ne conservent pas nécessairement la session. Vérifications : `node scripts/onboarding-session-smoke.mjs`.

## Filtre géographique

Le filtre « Pouvoir d’achat du pays » propose tous les pays, fort, plus faible et non renseigné. Il reprend la segmentation interne de `admin-masterclass-optin.js` : FR, BE, CH, CA, LU, MC, DE dans le groupe fort, autres pays connus dans le second groupe ; valeurs absentes ou non reconnues à part. Les codes et les noms de pays en français ou anglais sont reconnus (casse/accents ignorés). Le pays corrigé (`country_override`) prime sur le pays source. Il ne s'agit pas d'une estimation de solvabilité personnelle ni d'un classement économique universel.

Le groupe se combine au statut et à la recherche. Le total et la pagination portent sur l'intersection ; les compteurs rapides portent sur l'ensemble du groupe, indépendamment du statut/recherche. Le mode « Tous » conserve la requête habituelle. Les autres groupes lisent les métadonnées minimales de tous les dossiers autorisés avant pagination, puis seulement les 50 fiches retenues, avec le même filtre d'attribution à chaque lecture. Au-delà de 10 000 métadonnées, la lecture échoue explicitement au lieu de donner des totaux partiels. Aucun SQL à installer, aucune mutation des dossiers.

## Temps écoulé depuis l’inscription

Un indicateur neutre « Inscrit depuis… » sur chaque élève, dans la liste et la fiche, affiche le temps réellement écoulé depuis l'inscription à la formation (`purchased_at`) en jours, heures et minutes, sans secondes, échéance ni couleur d'alerte.

Il continue après un contact réussi ou un onboarding réalisé et ne dépend pas de l'historique des contacts. Les saisies et suppressions d'entrées n'affectent pas cette durée. Une date manquante, invalide ou future affiche un état indisponible, jamais une durée inventée ou négative.

Le compteur suit l'heure serveur et ne déclenche aucune requête chaque seconde ; les notes ouvertes ne sont pas remplacées par les actualisations. Les métadonnées de premier contact restent compatibles côté API, mais ne pilotent plus cet affichage. Aucune nouvelle colonne, aucun nouveau webhook.

## Paiements : limite explicite

Le calendrier J+7 par défaut est **théorique**, pas une confirmation de prélèvement ou de fonds disponibles. Les échéances historiques vérifiées dans Spiffy peuvent le remplacer. Ce CRM ne déclenche aucun paiement et ne certifie pas les encaissements : les marqueurs `paid` de l'inscription à 0 € ne sont pas affichés comme une mensualité réglée. L'échéance historique de Leila est un repère vérifié le 17/09, pas une synchronisation permanente de ses prochaines échéances.

## Installation — Sonny uniquement

1. Exécuter `sql/onboarding_crm.sql` dans Supabase. Transaction réexécutable : crée les objets dédiés, autorise les deux comptes et rattrape les engagements zéro éligibles.
2. Après confirmation que Leila doit être incluse, exécuter `sql/onboarding_crm_history.sql` : exception ancien modèle 3×767 €, trois coachings, pas de démarrage à 0 €. Ajoute aussi les repères historiques déjà vérifiés. Aucun message client.
3. Exécuter `sql/onboarding_crm_contact_history.sql` : ajoute la saisie rétrospective, l'historique supprimable et le coaching agendé. Réexécutable sans écraser les notes existantes ; l'ancienne commande de sauvegarde reste compatible.
4. Vérifier les compteurs avec les requêtes ci-dessous et tester la connexion de Romain sur la preview.
5. Relire le parcours et valider avant mise en production, exclusivement par `npm run deploy:production`, depuis un `main` propre et synchronisé.

```sql
select source, plan, count(*) from public.onboarding_cases group by source, plan;
select s.role,s.active,s.default_assignee,a.label
from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id;
```

## Sécurité et fiabilité

- La liste par défaut « Dossiers en cours » exclut les accueils réalisés. Ils sont conservés avec toutes leurs notes dans « Accueils réalisés », même en recherche et avec un filtre pays. Le compteur « Dossiers en cours » exclut également les terminés. « À contacter » regroupe les nouveaux et les relances arrivées à échéance. Ce classement est partagé entre la démonstration et l’API, avant pagination, sans migration ni effacement.

- Cookie signé HttpOnly existant, compte actif avec mot de passe requis ; un code de recrutement ne suffit pas.
- Chaque requête contrôle l'autorisation dédiée. Filtrage par coach pour la lecture et contrôle de l'attribution dans la transaction d'écriture. Le rôle propriétaire supervise tous les dossiers.
- RLS activée, aucun accès aux tables / RPC via `anon` ou `authenticated`. Service-role côté serveur exclusivement.
- API same-origin et en-tête personnalisé anti-CSRF, réponses privées `no-store`. Pas de pixel, d'analytics, de police tierce ou de données réelles dans la page statique.
- Écriture et historique atomiques ; identifiant de commande idempotent contre les doubles clics/reprises réseau ; verrou et version contre l'écrasement entre onglets.
- Brouillon gardé à l'écran lors d'erreur, aucune substitution par le polling ; avertissement avant fermeture/changement de dossier, copier le brouillon possible. Pas de stockage durable des notes dans localStorage. Une fermeture forcée du navigateur peut donc perdre un brouillon non enregistré.
- Accès base limité à 10 s par appel, erreur utilisateur sans information technique sensible.

## Tests, en local sans toucher aux clients

```sh
node scripts/onboarding-crm-smoke.mjs
npm run dev -- --host 127.0.0.1 --port 4378
node scripts/onboarding-ui-smoke.mjs
npm run build
npm run deploy:preview
```

Tests SQL dans PostgreSQL WASM éphémère (PGlite) : migration deux fois, import, doublons, exclusions, droits, notes préservées, concurrence, transaction, dates, révocation. Tests HTTP simulés et navigateur avec fiches fictives : mobile/desktop, recherches, actions, brouillons, panne, conflit et injection HTML.

## Arrêt / retour arrière

Laisser l'espace hors production tant que non validé. Après activation, désactiver `onboarding_staff.active` du compte visé (et `default_assignee` ensemble si c'est le coach par défaut) suffit à lui retirer l'accès sans toucher à ses droits closer. Le retrait ultérieur de ces nouveaux fichiers n'affecte pas les checkouts ; conserver les tables pour ne pas perdre les notes. Ne pas supprimer les données pour un simple retour arrière.
