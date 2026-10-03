# Réinscription MC2 — préparation du 3 octobre 2026

## État réel

Publication autorisée par Sonny après validation. Activation contrôlée par
MC2_REREGISTRATION_ENABLED=true (désactivé par défaut). Les trois prérequis
SQL ont été exécutés par Sonny et leur présence vérifiée en lecture seule.
Sonny a confirmé history_ready=true puis transaction_ready=true pour les deux migrations.
Politique pure testée (17 cas), chargement historique testé avec mocks et pagination.
La seconde migration mc2_reregistration_transaction.sql est testée sur PGlite
éphémère (réexécution, refus achat/CTA, rollback job en cours, répétition du POST,
archivage, conservation attribution, permissions). Sonny confirme son exécution
sur Supabase ; ce document ne constitue pas une vérification indépendante du schéma distant.
Elle est nécessaire pour rendre indivisibles l'archive et le changement de session.

La génération est propagée aux lecteurs et aux endpoints de tracking/présence,
avec filtres sur les écritures de résumé et de délai d'offre. Les anciens accès
replay sont refusés après changement de session. Les tests mockés des endpoints
vérifient notamment le refus d'un ancien onglet et d'un POST répété.
La course validation/ingestion est protégée par le trigger transactionnel.
Une répétition du POST pour la même nouvelle session retente les files idempotentes
si une réponse ou une mise en file a échoué après le commit. Les événements
financiers proviennent toujours des fournisseurs de paiement, jamais du tracking.

Vérifications locales du 3 octobre : build Astro réussi (316 pages), suites de
politique, historique, endpoints et transaction SQL réussies. Suites de pays,
tracking v2, replay et worker replay réussies. Le test existant des emails de
session a été réaligné sur le timing CTA approuvé (écart de 46 secondes) et passe ;
aucun horaire de production modifié. Le test inline-checkout préexistant attend
une section CGV/prix absente du HEAD officiel : ses fichiers sources concernés
sont inchangés par cette tâche. Aucun changement aux CGV, prix ou paiements.

## Protection transactionnelle ajoutée le 3 octobre

Sonny autorise la publication une fois les contrôles terminés. Rien n'a été publié.
Les deux premiers prérequis ont été confirmés indépendamment par SELECT.
Le test `mc2-reregistration-tracking-race-smoke.mjs` reproduit un événement CTA
ancien accepté après changement de génération entre le lookup API et l'ingestion.
Le complément `sql/mc2_reregistration_tracking_guard.sql` ferme cette course par
un verrou SHARE et une vérification au moment de l'insertion. Réexécution,
déduplication, compatibilité génération 0 et absence d'outbox après rejet testées
sur PGlite local. Sonny a exécuté ce complément, et tracking_guard_ready=true
a été vérifié par SELECT. Aucun test n'envoie de communication client réelle.

## Règle approuvée (détail)

- Achat enregistré ou CTA réellement atteint en lecture : refuser une nouvelle
  inscription. Ne pas interrompre la lecture de la session qui atteint le CTA.
- Absence, compteur seul, abandon avant CTA : autoriser une nouvelle tentative
  après la fin de la session actuelle, indépendamment de l'utilisation du replay.
- Replay proposé sans obligation. Aucun nouveau message client approuvé ici.
- Une session active à la fois ; conserver acquisition et historique ; respecter
  les consentements et les règles de pays SMS existantes.

## Rétroactivité

Réévaluer les anciens contacts à leur prochaine demande, sans supprimer en masse
les exclusions. `inscrit_mc2`/`inscrit_webinaire` ne seront plus des preuves de
visionnage. Lire tous les historiques correspondant à l'email, y compris legacy.
`cta_playback_present` est une preuve explicite. `saw_offer`, `attended_live`,
position maximale ou compteur ne suffisent pas seuls. Pour les anciennes versions,
reconstruire seulement avec des preuves documentées et des timings versionnés ;
ne jamais appliquer le timing de la vidéo actuelle à une ancienne vidéo.
Une lacune de tracking autorise la réinscription ; une panne de lecture de la base
doit demander une nouvelle tentative, pas écraser une inscription inconnue.

Audit initial SELECT (tous pays, hors tests identifiés) : 242 CTA explicites,
563 anciens signaux d'offre à qualifier, 2948 sessions passées sans CTA explicite,
26 achats/engagements enregistrés et 204 sessions non terminées. Ces nombres ne
sont PAS une liste prête à modifier : exclusions protégées et preuves historiques
doivent encore être croisées. Certains anciens engagements à zéro ont le statut
paid ; conserver leur protection tant que leur situation n'est pas réconciliée.

## Suite après exécution du prérequis

Validation finale locale : les cinq suites de réinscription passent (politique,
historique, endpoints avec POST concurrents simulés, SQL et course de tracking).
Le formulaire construit passe à 390 et 1280 px avec un ancien cookie, ses trois
étapes et la confirmation ; toutes les API et le widget téléphonique sont simulés.
Les tests navigateur d'accès, tracking v2/Meta, replay, emails, pays et SMS passent.
Le sas `deploy:check` et la preview Netlify du 3 octobre sont validés, y compris
le démarrage des fonctions. Pas de transaction de paiement ni d'envoi client réel.
Ce n'est pas une garantie de disponibilité absolue des services tiers.

1. Relier la décision commune à check-mc2-eligibility ET register-mc2 ; aucun
   contournement en appelant directement l'inscription.
2. Archiver l'ancienne ligne avant toute modification et effectuer la transition
   avec protection contre requêtes simultanées et achat/CTA concurrent.
3. Préserver registered_at et attribution d'acquisition ; distinguer tentative et
   prospect unique. Ne pas renvoyer les événements Meta de nouvelle acquisition.
4. Protéger les queues email/SMS/replay contre les anciennes sessions, ainsi que
   les accès/événements tardifs d'un ancien onglet. Ne jamais envoyer un message
   de test réel. Garder les consentements et les plafonds SMS.
5. Tester deux requêtes simultanées, deux onglets, répétition du POST, panne
   d'archivage, panne de file, achat concurrent, CTA replay, achat legacy,
   anciens liens et rappel en cours. Aucune activation sans ces tests.
6. Preview puis validation ; production uniquement par le sas depuis main propre.

La table créée par `sql/mc2_reregistration_history.sql` est privée et ne possède
aucune policy navigateur. Aucune inscription n'est copiée ou modifiée par cette
migration. Pas de changement aux audiences Meta ni aux campagnes MailerLite.
