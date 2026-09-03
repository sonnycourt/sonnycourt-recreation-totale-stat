# Alignement CGV et paiement MC2

## Offre Esprit Subconscient 2.0 en vigueur

- Paiement unique : **1 997 € TTC**.
- Paiement fractionné : **3 × 767 € TTC**, soit **2 301 € TTC**.
- La première mensualité est débitée à la commande, puis les deux suivantes
  sont prélevées mensuellement.
- Le paiement unique économise **304 € TTC** par rapport aux trois mensualités.
- Achat unique, sans abonnement et sans renouvellement.
- **Garantie Manifestation pendant un an** : la seule condition d’éligibilité
  est de terminer l’intégralité du parcours principal avant le premier
  anniversaire de la commande.
- Les bonus, séances facultatives, résultats financiers et justificatifs de
  résultat ne sont pas exigés. La progression est vérifiée côté plateforme.
- Une demande recevable rembourse toutes les sommes encaissées, annule les
  mensualités futures et ne retire pas les accès numériques déjà accordés.

Les checkouts Spiffy intégrés à `/mc2/session/` et `/mc2/replay/` affichent et
encaissent ces deux options. Le plan choisi, son prix total et son échéancier
sont repris dans la preuve contractuelle associée à la commande.

## Pages

- `/cgv/` : page de vente contractuelle distincte.
- `/conditions-utilisation/` : CGU uniquement ; les anciennes ancres de
  remboursement restent valides et renvoient vers `/cgv/`.
- `/confidentialite/` : prestataires et traitements actuels documentés.
- `/mc2/session/` et `/mc2/replay/` : la case d'acceptation Spiffy pointe vers
  `/cgv/` et le checkout reprend le plan sélectionné.
- Footer et `/pages-legales/` : lien CGV ajouté.

## Variables contractuelles

```text
MC2_CONTRACT_VERSION=mc2-cgv-2026-09-v6
MC2_TERMS_URL=https://sonnycourt.com/cgv/
MC2_CONTRACT_ACCEPTANCE_TEXT=J’accepte les CGV et l’échéancier clairement indiqué ci-dessus.
```

Une copie figée de la version acceptée est conservée :

```text
MC2_TERMS_SNAPSHOT_URL=https://sonnycourt.com/legal-archives/mc2-cgv-2026-09-v6.pdf
MC2_TERMS_SNAPSHOT_SHA256=dc19e5a898ca584149a7bc48e2a3093f1786c47571ab5c08e186067681fb6fc2
```

Les variables `MC2_CONTRACT_EXPECTED_*` et les anciennes archives restent
conservées uniquement pour les contrats Stripe historiques. Elles ne décrivent
pas l'offre Spiffy actuellement affichée et ne doivent jamais être utilisées
pour réécrire un ancien contrat.

## Note sur les taxes

Le code conserve `automatic_tax`. Le prix TTC affiché suppose que le Price
Stripe est configuré en `tax_behavior=inclusive`. La configuration et les
registrations doivent être confirmées dans Stripe avant activation ; aucune
registration n'a été créée ou modifiée par ce travail.
