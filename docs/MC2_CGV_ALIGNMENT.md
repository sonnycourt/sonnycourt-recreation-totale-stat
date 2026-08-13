# Alignement CGV et paiement MC2

## Contrat validé dans le code

- Prix total TTC : **1 235 €**.
- Paiement initial : **47 € aujourd'hui**.
- Suite : **4 échéances de 297 € espacées de 21 jours**.
- Échéances : **J+14, J+35, J+56 et J+77**.
- Achat unique, sans intérêt, sans abonnement et sans renouvellement.
- Annulation ES2 pendant les 14 premiers jours : remboursement des 47 €,
  annulation des échéances futures et retrait immédiat des accès.

Le code Stripe vérifie maintenant que le Price initial est actif, ponctuel,
inclusif, en EUR et exactement égal à 4 700 centimes. Il vérifie aussi que le
Price des échéances est actif, récurrent mensuel, inclusif, en EUR et exactement
égal à 29 700 centimes avant d'ouvrir un checkout ou de créer le calendrier. Le
calendrier Stripe utilise quatre phases successives de trois semaines, avec une
nouvelle ancre de facturation à chaque phase.
Aucun ancien Price `150 + 11 x 197` ne peut être repris par défaut.

## Pages

- `/cgv/` : page de vente contractuelle distincte.
- `/conditions-utilisation/` : CGU uniquement ; les anciennes ancres de
  remboursement restent valides et renvoient vers `/cgv/`.
- `/confidentialite/` : prestataires et traitements actuels documentés.
- `/commencer/` : le lien de la case d'acceptation pointe vers `/cgv/`. Sans
  modifier la mise en page, les quatre dates affichées sont désormais calculées
  à J+14, J+35, J+56 et J+77.
- `/commencer/succes/` : le récapitulatif post-paiement reprend 47 € payé,
  4 × 297 € à J+14, J+35, J+56 et J+77, et le total TTC de 1 235 €.
- Footer et `/pages-legales/` : lien CGV ajouté.

## Action Stripe manuelle obligatoire

Le dépôt 47 € existant n'a pas été modifié. Aucun objet Stripe live n'a été
créé pendant l'alignement.

1. Dans Stripe, créer ou retrouver sous le produit MC2 un Price **récurrent** :
   - montant : `297,00 EUR` ;
   - intervalle : mensuel ;
   - `tax_behavior` cohérent avec un prix TTC (`inclusive`) ;
   - actif.
2. Renseigner son identifiant `price_...` dans
   `MC2_STRIPE_INSTALLMENT_PRICE_ID`.
3. Archiver côté Stripe les anciens Prices uniquement après avoir vérifié
   qu'aucun ancien échéancier client ne les utilise encore. Ne jamais les
   supprimer ni les remplacer dans les anciens contrats.
4. Vérifier que le Price initial 47 € est bien TTC/inclusif et que le Product
   possède le tax code validé pour la formation numérique. S’il ne l’est pas,
   créer un nouveau Price ponctuel 47 € inclusif puis renseigner son ID dans
   `MC2_STRIPE_ENTRY_PRICE_ID` ; ne pas réutiliser un Price incompatible.
5. Confirmer que Stripe Tax possède bien les registrations actives nécessaires :
   `automatic_tax` ne collecte rien dans une juridiction sans registration.

## Variables contractuelles à configurer avant activation

```text
MC2_CONTRACT_VERSION=mc2-cgv-2026-08-v4
MC2_TERMS_URL=https://sonnycourt.com/cgv/
MC2_CONTRACT_ACCEPTANCE_TEXT=J’accepte les CGV et l’échéancier clairement indiqué ci-dessus.
MC2_CONTRACT_EXPECTED_PAYMENT_PLAN=47_now_then_4x297_days_14_35_56_77
MC2_CONTRACT_EXPECTED_ENTRY_CENTS=4700
MC2_CONTRACT_EXPECTED_TOTAL_CENTS=123500
MC2_CONTRACT_EXPECTED_SCHEDULE_JSON=[{"label":"Aujourd’hui","due_offset_days":0,"amount_cents":4700,"installments":1},{"label":"Échéance 1","due_offset_days":14,"amount_cents":29700,"installments":1},{"label":"Échéance 2","due_offset_days":35,"amount_cents":29700,"installments":1},{"label":"Échéance 3","due_offset_days":56,"amount_cents":29700,"installments":1},{"label":"Échéance 4","due_offset_days":77,"amount_cents":29700,"installments":1}]
```

Il faut aussi fournir une copie figée de cette version des CGV :

```text
MC2_TERMS_SNAPSHOT_URL=https://sonnycourt.com/legal-archives/mc2-cgv-2026-08-v4.pdf
MC2_TERMS_SNAPSHOT_SHA256=fdc3d84dfa34c036b14559508dc460138284e4417456de7d1914e8766316dcb2
```

Les flags d'activation checkout, recouvrement et exports restent désactivés
jusqu'au test sandbox complet. Aucun changement Supabase n'est requis par cet
alignement.

## Note sur les taxes

Le code conserve `automatic_tax`. Le prix TTC affiché suppose que le Price
Stripe est configuré en `tax_behavior=inclusive`. La configuration et les
registrations doivent être confirmées dans Stripe avant activation ; aucune
registration n'a été créée ou modifiée par ce travail.
