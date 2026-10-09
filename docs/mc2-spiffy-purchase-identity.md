# Rattachement certain des achats MC2 — 9 octobre 2026

## Cause vérifiée

Le checkout Spiffy 40006 dispose déjà du champ natif `MC2 Token`, lié au
paramètre URL `mc2_token`. Le site le transmet correctement.
La commande concernée conservait cette référence dans `fields` : objets
`{ field_name: 'mc2_token', value: '…' }`, et non dans `preserved_params`.
La notification v2 `order:success` livrée à notre webhook n'incluait pas
l'expansion `fields`. Elle a donc été ignorée avec `lead_not_found` lorsque
l'email de paiement différait de celui de l'inscription.

## Correctif

- Pour les checkouts actuels 40006/40007, si la notification de vente n'a pas
  de référence, lire **la commande exacte** via l'API Spiffy en GET, avec
  `include=fields,customer,checkout`. Vérifier ID, checkout, email de paiement
  et statut réussi. La clé `SPIFFY_ONBOARDING_API_KEY` existe déjà en production.
- Lire les références au niveau de la commande ; ignorer les profils clients
  mutables, noms, téléphones et rapprochements approximatifs. Une référence
  invalide, inconnue ou contradictoire n'autorise aucun autre rattachement.
- En l'absence confirmée de référence, conserver le rapprochement historique
  par email strictement identique, uniquement s'il donne une inscription unique.
- Si l'API ou la base est indisponible, répondre 503 pour permettre une nouvelle
  livraison du webhook. Ne pas remplacer une lecture indisponible par une
  recherche d'identité approximative.
- Vérifier l'unicité du rattachement de la commande et le propriétaire d'un
  événement déjà enregistré, y compris en cas de collision à l'insertion.
- Conserver séparément l'email d'inscription et l'email d'achat ; enregistrer
  la source du rapprochement dans les métadonnées de l'achat.
- Lire `detail.due_today` / `display_total` du format v2 pour sélectionner les
  bonnes modalités : 197 € initiaux / 2 364 € contractuels, ou 1 297 € unique.

Aucune modification des formulaires Spiffy, des paiements, de l'interface
du funnel ou du schéma Supabase. Aucun email/SMS de test. Pas de rattrapage
automatique d'anciennes commandes ni de rejeu de webhook dans cette tâche.

## Validation

Le nouveau lecteur a retrouvé l'inscription exacte de la commande concernée
en lecture seule (identifiant unique, pas une corrélation de nom ou d'horaire).

Tests ciblés : `npm run test:mc2-spiffy-identity`,
`mc2-spiffy-purchase-webhook-smoke`, `mc2-draftx-post-purchase-smoke`,
`mc2-current-spiffy-plans-smoke`, `mc2-spiffy-sms-cancellation-smoke`,
`mc2-session-emails-smoke`, `mc2-replay-recovery-smoke`.
Compilation Astro réussie : 321 pages.

Deux contrôles anciens hors correctif restent désynchronisés avec les sources
de base : `mc2-spiffy-checkout-smoke` exige encore `DealOffer.astro` au lieu de
`DealOfferDraftX.astro`, et `mc2-consultation-bonus-smoke` attend un ancien horaire
d'apparition de l'offre (10:24:00 au lieu de 10:20:32). Aucun contournement ni
modification de leurs attentes dans ce correctif.

Le 9 octobre, ces deux échecs ont été reproduits sur `main` non modifiée
(`9f2a550`) dans le worktree de la précédente publication : ils sont antérieurs
au correctif. Les sept suites ciblées et `deploy-runtime-guards-smoke` passent.

## Mise en service

Publication autorisée par Sonny le 9 octobre, sous réserve des contrôles
anti-régression. Correctif préparé dans le worktree isolé. Fusionner explicitement
sur `main`, vérifier sa propreté et sa synchronisation avec `origin/main`, puis
utiliser exclusivement `npm run deploy:production` après autorisation de Sonny.
Une validation après publication doit rester en lecture seule ; ne pas créer
de paiement réel ni rejouer une notification sans autorisation spécifique.
