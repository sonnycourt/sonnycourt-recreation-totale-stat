# Réouverture publique MC2 — 27 septembre 2026

Sonny a demandé de rendre opérationnelle la version validée en local : opt-in
MC2 et Meta MC2, puis offre intégrée à la session au moment du CTA.

Les modifications précédentes figurent déjà dans la publication `44eac84`.
Cette livraison retire uniquement le verrou public des deux pages d’entrée.
Le parcours reste gratuit, en trois étapes : prénom/email, téléphone, présence.
Les anciens inscrits à l’entrée payante conservent leur traitement existant.

## Vérifications sans envoi client

- 20 tests métier : inscription, attribution, vidéos W14, timings, checkout,
  webhook, emails, SMS et suivi du parcours.
- Build public sans `preview=dev`, sur les deux pages et aux largeurs 390/1365 :
  capture partielle, validation, trois étapes, engagement, redirection token.
- Session et replay : deux plans, tracking, reprise après incident réseau.
- Contrôle direct du code des pages canoniques : offre masquée avant 5686 s
  en live / 4484 s en replay, visible à ces seuils. Aucune offre en confirmation.
- Vrais formulaires Spiffy aux largeurs 390/1000 : chargement, identité
  préremplie masquée, champ carte dimensionné, bouton PayPal présent. Toutes
  les requêtes non-GET ont été bloquées : aucun achat ni inscription Spiffy.
- Réglages email/SMS existants actifs, clés et groupes requis présents.
- Lecture seule des files Supabase des trois derniers jours : aucun job
  pending/retry/processing en retard de plus de dix minutes.

## Limites conservées

- Aucun paiement réel, validation 3DS, ni réception d’email/SMS de test.
- SMS H+2 toujours désactivé, validation finale du texte nécessaire.
- Apple Pay et Google Pay intégrés restent soumis au blocage Spiffy documenté
  dans `mc2-spiffy-wallets-blocker-20260927.md`. Aucun faux bouton ajouté.
- Aucune campagne Meta relancée, aucun changement de schéma Supabase.

Publication exclusivement via `npm run deploy:production`, avec contrôle distant
des fonctions et routes critiques, puis vérification des pages publiques.
