# Dossiers de recouvrement MC2

## Garde-fous

- Le système est **OFF** tant que `MC2_COLLECTION_CASES_ENABLED` n'est pas `true`.
- Aucune société de recouvrement n'est appelée.
- Aucun export n'est possible tant que `MC2_COLLECTION_EXPORTS_ENABLED` n'est pas `true`.
- Même avec ce second flag, l'export refuse tout dossier non approuvé humainement.
- Le déclencheur exige **exactement cinq reprises Stripe échouées** : `retry_count = 5`, dette épuisée et impayée.
- Les preuves contractuelles, tentatives, révisions et événements d'audit sont append-only.

Le mot « cinq » désigne les **cinq reprises automatiques après l'échec
initial**. Stripe aura donc produit six événements d'échec au total. Les cinq
reprises numérotées 1 à 5 doivent toutes être présentes pour que le dossier soit
déclaré complet.

## Contenu préparé

- identité, email, téléphone et adresse post-achat (Stripe comme repli) ;
- version des CGV, texte accepté, date, IP, user-agent, empreinte SHA-256 ;
- offre, échéancier, prix contractuel, paiements encaissés et solde ;
- échec initial puis cinq reprises avec date, code de refus et identifiants Stripe ;
- communications MailerLite enregistrées ;
- historique des factures Stripe, PDF/URL de facture et lignes d'échéance ;
- snapshot versionné, complétude et audit immuable.

Le dossier arrive en `ready_for_review` s'il est complet, sinon en
`needs_information`. Il ne part nulle part. La validation humaine utilise une
confirmation exacte `APPROUVER MC2-…` ou `REJETER MC2-…`.

## Installation, sans activation

1. Sonny exécute `sql/mc2_collection_cases.sql` dans Supabase.
2. Configurer :
   - `MC2_CONTRACT_VERSION` ;
   - `MC2_TERMS_URL` ;
   - `MC2_TERMS_SNAPSHOT_URL` et `MC2_TERMS_SNAPSHOT_SHA256` ;
   - `MC2_CONTRACT_ACCEPTANCE_TEXT` avec le texte exact de la checkout ;
   - `MC2_CONTRACT_EXPECTED_PAYMENT_PLAN`, `MC2_CONTRACT_EXPECTED_ENTRY_CENTS`
     et `MC2_CONTRACT_EXPECTED_TOTAL_CENTS`, plus
     `MC2_CONTRACT_EXPECTED_SCHEDULE_JSON`, strictement identiques à l'offre
     réellement affichée. Une divergence bloque le paiement au lieu de créer
     une preuve contractuelle contradictoire.
3. Lancer `npm run test:mc2-collection-cases`.
4. Vérifier avec :
   `netlify env:list --json | npm run check:mc2-collection-cases`.
5. Conserver `MC2_COLLECTION_CASES_ENABLED=false` et
   `MC2_COLLECTION_EXPORTS_ENABLED=false` jusqu'au test sandbox complet.

## Activation ultérieure

1. Test Stripe sandbox : achat, échec initial et cinq reprises simulées, dossier construit.
2. Contrôle manuel des montants, adresse, CGV, six échecs Stripe (initial + cinq reprises) et factures.
3. Validation juridique de la version des CGV et de la somme exigible.
4. Activer uniquement la préparation avec `MC2_COLLECTION_CASES_ENABLED=true`.
5. Choisir le prestataire et son format avant d'envisager les exports.

Le format neutre disponible est JSON ou CSV. Aucun PDF lourd n'est généré : la
facture PDF officielle reste celle de Stripe et son URL figure dans le snapshot.

## Blocages connus avant activation

- Le code, la checkout et les CGV sont alignés sur `47 € + 4 × 297 €`
  (1 235 €). Avant activation, il reste à créer ou identifier dans Stripe un
  Price mensuel actif de 297 € TTC, à renseigner dans
  `MC2_STRIPE_INSTALLMENT_PRICE_ID`, puis à aligner les variables
  `MC2_CONTRACT_EXPECTED_*`. Le garde-fou contractuel bloque toute acceptation
  incohérente.
- La fonction `mc2-billing-info` est prête à enregistrer l'adresse dans
  `mc2_registrations` et chez Stripe, mais le parcours `/commencer/succes/`
  n'appelle pas encore le formulaire d'adresse MC2. L'ancien formulaire
  `/es2-derniere-etape/` écrit dans l'ancien modèle et ne doit pas être confondu
  avec celui-ci.
- Le `balance_due_cents` préparé correspond au reliquat contractuel. Avant tout
  export, un humain et le conseil juridique doivent confirmer quelle somme est
  effectivement exigible à cette date (échéance impayée seule ou déchéance du
  terme valablement applicable).
