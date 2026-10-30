# Remplacement du SMS de fin d'offre par un rappel H−1

Texte approuvé par Sonny dans ce chat le 30 octobre 2026 :

> Ta masterclass avec Sonny commence dans 1 heure !
> Reserve ce moment pour toi.
> Ton lien pour nous rejoindre :
> [lien personnel]

## Activation

1. Sonny exécute `sql/mc2_session_h1_sms.sql` dans Supabase.
2. Vérifier en lecture seule l'existence de la fonction et de la contrainte.
3. Publier uniquement avec `npm run deploy:production`, depuis main propre et synchronisé.
4. Activer `MC2_SESSION_H1_SMS_ENABLED=true` dans l'environnement des fonctions de production (publication requise si les variables sont liées au déploiement).
5. Contrôler les vrais jobs et les accusés de livraison GatewayAPI. Aucun envoi réel de test.

Tant que ce flag est absent/false, le comportement de production reste inchangé.
Une fois activé, il neutralise `MC2_OFFER_H1_SMS_ENABLED` : les futurs jobs fin
d'offre ne sont plus créés et ceux encore en attente sont ignorés par le worker.
Les historiques sont conservés. Le SMS live reste inchangé pour tous les créneaux.
Le SMS distinct H+2 après l'offre, s'il est activé, reste inchangé.

## Périmètre et garde-fous

- `scheduled` correspond aux créneaux 11 h et 20 h dans le fuseau de l'inscrit.
- Pas de H−1 pour `jit`, ni pour une inscription finalisée après H−1.
- Horaires absolus UTC : pas de calcul fragile lié au changement d'heure.
- Rattrapage maximum de 10 minutes ; aucun rattrapage historique massif.
- Consentement SMS et téléphone obligatoires, filtre pays existant conservé.
- Exclusion des acheteurs, tests et accès masterclass non réglés.
- Relecture de l'inscription juste avant envoi pour les changements de créneau.
- Déduplication par token/horaire, claim atomique et marqueur avant GatewayAPI.
- Un échec réseau ambigu n'est pas renvoyé automatiquement (évite les doublons).
- Lien live personnel existant, suffixe `?r=h1` pour séparer les clics H−1/live.
- Événements `sms_session_h1_sent` et `sms_session_h1_link_clicked`.

## Mesure

Comparer 7 jours avant/après activation : inscriptions scheduled finalisées,
présence, arrivée à l'offre et achat (même fenêtre d'observation). Segmenter
matin/soir, Meta/hors Meta et pays. Garder JIT comme comparaison distincte.
Ne pas confondre `sent/accepted` Supabase avec `Delivered` chez GatewayAPI.

## Retour arrière

Remettre `MC2_SESSION_H1_SMS_ENABLED=false`, puis republier si nécessaire.
Les jobs H−1 désactivés ne sont pas envoyés. Le réglage précédent de fin d'offre
redevient effectif ; les anciens jobs déjà ignorés ne sont pas ressuscités.
Ne pas annuler la migration : l'historique peut contenir le nouveau type.
