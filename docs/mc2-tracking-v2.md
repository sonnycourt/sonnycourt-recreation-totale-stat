# MC2 : mesures v2 — 16 septembre 2026

## Séparation stricte

Le journal v2 mesure le parcours. Il ne décide jamais de l'accès, de la lecture,
des échéances, du paiement ou d'un envoi client. Les mécanismes historiques qui
servent encore au fonctionnement du funnel restent en place. Aucune session
ouverte n'est forcée à se recharger.

Le nouveau cockpit est `/es-cockpit/mc2-tracking/`, protégé par la session admin.
L'ancien cockpit reste disponible mais ses compteurs MC2 sont explicitement
signalés comme historiques et incomplets. Ne pas additionner v1 et v2.

## Définitions

| Mesure | Preuve retenue |
|---|---|
| Inscription | `registration_completed_at`, source Supabase |
| Parcours observé | Événement v2 `journey_started` |
| Lecture | Progression continue de la position ; pas de saut ou de pause |
| Rétention minute | ≥ 1 seconde média observée au premier plan dans cette minute, personne dédoublonnée |
| Présence au CTA | Intervalle continu traversant 94:50 live / 74:50 replay, au premier plan ; compteur d'images avançant lorsqu'il est disponible |
| Lecture en arrière-plan au CTA | Progression traversant le même seuil mais onglet masqué ; comptée séparément, pas une offre vue |
| Offre disponible | État d'ouverture réel de l'offre sur la page, pas preuve de lecture |
| Offre visible | Au moins 80 px (ou la hauteur du petit élément) dans le viewport pendant 1 seconde, sans modal checkout ni plein écran |
| Scroll | Déplacement ≥ 12 px après un geste utilisateur, offre à l'écran ; un scroll programmatique seul ne suffit pas |
| Profondeur | 5/10/25/50/75/90/100 % de l'offre actuelle, indépendamment de la taille totale de la page |
| Sections | Prix, cinq bonus, tarif, garantie, témoignages, choix final : sélecteurs de l'offre actuelle |
| Checkout | Ouverture effective, bouton source, tentative, étapes vues 1/2/3, étapes 1/2 validées, plan, fermeture |
| Paiement affiché | Iframe rendue visible après les signaux Spiffy existants `ready` et hauteur ; ne prouve pas que le client a saisi sa carte |
| Engagement / commande | Événement serveur Spiffy `purchase_completed`, pas une redirection navigateur |
| Encaissement | Non déduit de l'engagement à 0 €. Le registre prestataire reste la référence pour les mensualités |

Le retrait de 20 minutes dans le replay est un décalage **média**. Il ne faut pas
le confondre avec le démarrage live 15 minutes avant l'heure annoncée.
Les durées et seuils viennent de `mc2-timing.mjs` ; versions média et offre sont
enregistrées par le serveur. Les secondes remplacent les anciennes unités ambiguës.

Une image fixe dans le contenu n'est pas un freeze : on observe le compteur
d'images du lecteur, pas les pixels de l'image. Un navigateur qui ne fournit pas
ce compteur reste mesuré via la progression, avec la limite explicitement stockée.
Ces signaux prouvent un comportement du lecteur, jamais l'attention humaine.

## Fiabilité du transport

- Identifiant UUID stable par événement ; insertion idempotente.
- File `sessionStorage`, conservée jusqu'à accusé de réception de la base.
- Reprise après rafraîchissement et réseau rétabli, avec les mêmes identifiants.
- Requêtes normales sans `keepalive` ; une petite dernière tentative à la sortie.
- Lots ≤ 24 événements, timeout, retries bornés, pas de requête attendue par le player.
- Maximum 600 événements / environ 220 000 caractères / 24 h. Les pertes liées
  aux limites sont signalées ; aucune promesse de collecte exhaustive hors réseau.
- Vidéo observée toutes les secondes, intervalles ≤ 15 s. Les onglets masqués et
  les longues suspensions ne sont pas inventés comme des minutes regardées.
- Les erreurs restent confinées dans le tracking ; diagnostic inspectable via
  `window.__mc2JourneyV2.status()` sans données personnelles.
- Fermeture définitive, suppression du stockage, bloqueur ou plantage du navigateur
  peuvent toujours perdre les derniers signaux. Absence de trace ≠ abandon.

## Meta

Sonny a explicitement autorisé l'utilisation du pixel Meta existant et des mêmes
données de rapprochement : email/téléphone/identifiant hachés, cookies Meta,
IP et user-agent. Aucun changement des campagnes, du budget ou de l'optimisation.

Les événements v2 sont inscrits dans une file serveur atomiquement avec le journal :
`OfferViewed` (offre effectivement visible), `MC2_CTAPresent_v2`,
`MC2_PlaybackStarted_v2`, `InitiateCheckout`, `MC2_CheckoutStep2_v2`,
`MC2_CheckoutStep3_v2`. Les règles de source existantes sont conservées :
OfferViewed toutes sources pour le retargeting ; les autres pour `meta_ad`.

Un worker séparé réclame les tâches, attend l'accusé Meta et réessaie avec le même
ID opaque. Les nouvelles pages cessent d'envoyer les anciens signaux Meta CTA
fondés sur l'horloge et les milestones fondés sur une position maximale. Les
anciennes pages déjà ouvertes restent compatibles ; leurs événements restent legacy.

Le contexte de déploiement est lu depuis `runtime.deploy.context`, pas uniquement
une variable du build. Le worker cesse de prendre de nouvelles tâches après 10 s
pour rester sous la limite de 30 s des fonctions planifiées. Références :
[contexte runtime Netlify](https://docs.netlify.com/build/functions/api/),
[limites Netlify](https://docs.netlify.com/build/functions/configuration/).

Le cockpit expose les tâches en attente, reçues, à réessayer et en échec.
Une réception CAPI n'est pas une attribution publicitaire. Les envois historiques
Lead/Purchase ne sont pas migrés dans cette file dans ce lot ; leurs limites
identifiées dans l'audit ne doivent pas être présentées comme résolues.

## Périmètre du rapport

Fenêtre de 7 jours maximum, cohortes d'inscriptions finalisées dans la fenêtre et
actions observées dans cette même fenêtre. Filtres source et JIT/créneau.
Pays de référence affichés : France, Belgique, Suisse, Canada ; pays « Autre »
non classé. Ce regroupement n'est pas une mesure de solvabilité individuelle.

Un même inscrit est dédoublonné malgré plusieurs onglets, visites ou retries.
Les plages horaires de lecture sont fusionnées pour ne pas compter deux fois
le même temps. Les sources de dates et la couverture sont visibles par ID.
Les limites de pagination provoquent un avertissement explicite de rapport partiel,
pas un total faussement exhaustif. Les erreurs de lecture ne renvoient pas zéro.

## SQL / tests

Sonny exécute `sql/mc2_tracking_v2.sql`, puis
`sql/mc2_tracking_v2_meta_delivery.sql`. Les deux scripts sont réexécutables,
transactionnels, avec RLS sans accès anon/authenticated. Le second est requis
avant publication du nouveau collecteur. Ne pas les exécuter à sa place.

Les liens `preview=dev` et localhost ne transmettent rien. Les tests nominatifs
de production doivent être explicitement inscrits dans
`mc2_tracking_test_registrations` ; ne pas exclure tous les Suisses par défaut.

Tests automatisés : `npm run test:mc2-tracking-v2`,
`node scripts/mc2-tracking-browser-smoke.mjs`, plus non-régression live,
replay, anti-freeze, offre, accès, opt-in et Spiffy.
Les médias et services sont simulés dans les tests de navigateur : cela vérifie
le câblage réel des pages, pas la qualité du CDN ou un paiement réel.

## Limites et points conservés volontairement

- Pas de reconstruction fiable rétroactive des données manquantes.
- Pas de modification des webhooks d'achat, du provisionnement ni des relances.
- Le navigateur ne peut plus déclarer un achat et modifier un statut financier
  via `track-mc2-event` ; la confirmation serveur existante reste la source.
- L'authentification du webhook Spiffy et la réconciliation détaillée des
  mensualités restent des chantiers distincts, pour ne pas casser l'accès client.
- Pas de refonte des pixels/Clarity/GA ni de promesse de conformité globale de
  leurs règles de consentement dans ce lot.

## Publication et retour arrière

Vérifier les deux schémas par SELECT seulement, construire et tester. Fusionner
explicitement sur un `main` propre synchronisé, puis **uniquement**
`npm run deploy:production`. Vérifier les pages publiques sans inscription fictive
en production, puis les vrais événements entrants en lecture seule.

Si nécessaire, préparer un revert Git des modifications de ce lot et le faire
passer par le même sas de production. Conserver les nouvelles tables et les traces ;
ne pas supprimer de données et ne pas déverrouiller Netlify manuellement.
