# Bilan ES2 — compatibilité anciens membres et acheteurs MC2

## Cause

Les deux fonctions du bilan ne consultaient que `webinaire_registrations`.
Un acheteur enregistré uniquement dans `mc2_registrations` recevait un 404,
même avec l’adresse correcte et `payment_status = paid`.

## Correction

- Résolution partagée en lecture seule pour l’ouverture et l’enregistrement.
- Anciens acheteurs conservés, y compris le fallback si `es_purchased` est absent.
- Les acheteurs MC2 avec statut `paid` sont reconnus par email ou token.
- Une ancienne inscription prospect ne masque plus l’achat MC2 du même email.
- Un lien avec un ancien token connu peut résoudre cet achat MC2 ; son token
  canonique est ensuite enregistré dans `es2_feedback` (colonne texte sans FK).
- Les statuts non payés ne donnent pas accès. Un ancien achat remboursé ne suffit
  pas non plus. Un token inconnu ne peut pas être remplacé par un email fourni.
- Emails insensibles à la casse, avec contrôle d’égalité exacte après recherche.
- Les réponses d’accès contenant un token ne doivent pas être mises en cache.

Aucune migration SQL, aucune création/copie de compte, aucun historique modifié.
Les écritures de réponses et notifications existantes ne se produisent qu’à la
soumission volontaire du bilan par l’élève. Les tests ne contactent aucun service
réel : lectures, réponses et notifications sont toutes simulées.

## Vérification

`npm run test:es2-feedback`

Les tests couvrent l’ancien et le nouveau formulaire, les deux générations de
membres, les liens anciens, la normalisation des emails, les refus d’accès,
les erreurs Supabase, l’identité canonique, le stockage complet des réponses,
et les notifications existantes simulées.

Avant et après publication, contrôler uniquement le GET d’accès du cas signalé.
Ne jamais envoyer de bilan ni de notification en son nom pour tester.
