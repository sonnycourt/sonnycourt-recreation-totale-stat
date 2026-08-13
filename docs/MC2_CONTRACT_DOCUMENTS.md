# MC2 — documents contractuels post-achat

## État de l’implémentation

- Une seule page dynamique : `/documents-contractuels/:token-opaque`.
- Aucun fichier ni aucune page statique par client.
- Le document est créé uniquement par le webhook MC2 après un paiement initial
  Stripe `paid` de 47 €, avec produit, plan, total, devise et métadonnées MC2
  strictement vérifiés.
- Le snapshot et sa copie HTML autonome sont stockés immuablement à l’achat :
  47 € payé, total 1 235 €, puis 4 × 297 € aux dates exactes J+14, J+35,
  J+56 et J+77.
- Le lien public ne contient ni identifiant Stripe, ni email, ni token
  d’inscription. La page ne retourne aucune PII client.
- Entêtes `noindex`, `noarchive`, `no-store`, `no-referrer`, anti-frame et CSP.
- La page est imprimable et peut être archivée en PDF avec le navigateur ; une
  copie HTML autonome est aussi téléchargeable.
- Les CGV applicables pointent vers le PDF archivé et affichent son empreinte
  SHA-256. La page des CGV courantes reste fournie séparément.

## Activation locale, sans email

Sonny exécute d’abord `sql/mc2_contract_documents.sql` dans Supabase, puis la
variable suivante peut être activée après test sandbox :

```text
MC2_CONTRACT_DOCUMENTS_ENABLED=true
```

Le webhook reste idempotent grâce à l’unicité de `registration_token`. Le flag
est `false` par défaut ; sans la table SQL ou sans les variables contractuelles
valides, rien ne doit être activé.

Variables déjà exigées par le contrat MC2 :

```text
MC2_CONTRACT_VERSION=mc2-cgv-2026-08-v3
MC2_TERMS_URL=https://sonnycourt.com/cgv/
MC2_TERMS_SNAPSHOT_URL=https://sonnycourt.com/legal-archives/mc2-cgv-2026-08-v3.pdf
MC2_TERMS_SNAPSHOT_SHA256=2a2bc31df89646146de1acfe691c2c79cd9d32c2da5556b8ba86e7dbda6a7e99
```

## Email validé

Objet exact :

```text
Mise à disposition de vos documents contractuels
```

Corps exact :

```text
Bonjour {$first_name},

Nous vous informons que les documents relatifs à votre commande enregistrée le {$mc2_contract_purchase_date} sont désormais disponibles.

Cet espace documentaire regroupe votre confirmation de commande, votre récapitulatif contractuel, l’échéancier applicable, les conditions générales de vente ainsi que les informations relatives au droit de rétractation.

Ces éléments restent accessibles, consultables et téléchargeables depuis le lien personnel ci-dessous :

Consulter mes documents contractuels
{$mc2_contract_documents_url}

Ce message est généré automatiquement. Il ne nécessite aucune réponse.

Sonny Court
ArgEntrepreneur Sàrl
```

Sonny a validé le texte et autorisé explicitement la transmission à MailerLite
du prénom, du lien personnel opaque et de la date de commande. Le groupe
`MC2 — Documents contractuels`, les champs et le worker idempotent sont prêts.

Variables :

```text
MAILERLITE_GROUP_MC2_CONTRACT_DOCUMENTS=195721838546912284
MC2_CONTRACT_DOCUMENT_EMAILS_ENABLED=true
```

L’automation MailerLite « rejoint le groupe → email immédiat » a été créée,
relue et activée le 13 août 2026 avec le texte exact ci-dessus. La présence de
la table Supabase a été vérifiée en lecture seule et les deux flags production
ont ensuite été passés sur `true` ensemble.
