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

Appel sans réponse → SMS à envoyer maintenant. SMS **réellement envoyé manuellement**, marqué par le coach → rappel WhatsApp à +24 heures. Vocal enregistré → suite à décider, sans relance répétitive automatique. Un contact établi efface le rappel de non-réponse. Dossier en pause : ne pas relancer.

Notes privées : objectif, motivations, freins, routine, notes libres, accès formation/communauté. Historique daté des 100 dernières actions affiché ; tout l'historique est conservé en base. Liste paginée par 50, recherche nom/email/téléphone/pays/ville, compteurs calculés sur tous les dossiers autorisés.

J+14 et J+33 sont calculés depuis la date civile d'achat à Paris (changement d'heure testé). Les saisies d'heures de rendez-vous sont dans le fuseau de l'appareil, indiqué à l'écran. Le serveur refuse un coaching antérieur à J+33. Une date d'onboarding renseignée propose le statut « planifié » et un rappel interne à ce moment.

## Paiements : limite explicite

Le calendrier J+7 par défaut est **théorique**, pas une confirmation de prélèvement ou de fonds disponibles. Les échéances historiques vérifiées dans Spiffy peuvent le remplacer. Ce CRM ne déclenche aucun paiement et ne certifie pas les encaissements : les marqueurs `paid` de l'inscription à 0 € ne sont pas affichés comme une mensualité réglée. L'échéance historique de Leila est un repère vérifié le 17/09, pas une synchronisation permanente de ses prochaines échéances.

## Installation — Sonny uniquement

1. Exécuter `sql/onboarding_crm.sql` dans Supabase. Transaction réexécutable : crée les objets dédiés, autorise les deux comptes et rattrape les engagements zéro éligibles.
2. Après confirmation que Leila doit être incluse, exécuter `sql/onboarding_crm_history.sql` : exception ancien modèle 3×767 €, trois coachings, pas de démarrage à 0 €. Ajoute aussi les repères historiques déjà vérifiés. Aucun message client.
3. Vérifier les compteurs avec les requêtes ci-dessous et tester la connexion de Romain sur la preview.
4. Relire le parcours et valider avant mise en production, exclusivement par `npm run deploy:production`, depuis un `main` propre et synchronisé.

```sql
select source, plan, count(*) from public.onboarding_cases group by source, plan;
select s.role,s.active,s.default_assignee,a.label
from public.onboarding_staff s join public.closer_access_codes a on a.id=s.closer_id;
```

## Sécurité et fiabilité

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
