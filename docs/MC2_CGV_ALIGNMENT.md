# Alignement CGV et paiement MC2

## Offre Esprit Subconscient 2.0 en vigueur

- Paiement unique : **1 997 € TTC**.
- Paiement mensuel : **12 × 197 € TTC**, soit **2 364 € TTC**.
- La première mensualité est débitée à la commande, puis les onze suivantes
  sont prélevées mensuellement.
- Le paiement unique économise **367 € TTC** par rapport aux douze mensualités.
- Achat unique, sans abonnement et sans renouvellement.
- Garantie commerciale de 14 jours : remboursement des sommes encaissées,
  annulation des mensualités futures et retrait des accès.

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
MC2_CONTRACT_VERSION=mc2-cgv-2026-08-v5
MC2_TERMS_URL=https://sonnycourt.com/cgv/
MC2_CONTRACT_ACCEPTANCE_TEXT=J’accepte les CGV et l’échéancier clairement indiqué ci-dessus.
```

Une copie figée de la version acceptée est conservée :

```text
MC2_TERMS_SNAPSHOT_URL=https://sonnycourt.com/legal-archives/mc2-cgv-2026-08-v5.pdf
MC2_TERMS_SNAPSHOT_SHA256=82fa1f860ff8fc16972aa12fa32a85ca21a0c18131fb7904f7e313d9436963d5
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
