# Delta Vision — popup deux étapes (19 octobre 2026)

## Parcours

1. Le prénom et l’email passent par `delta-vision-register`, côté serveur.
2. MailerLite ajoute le contact au groupe **DeltaVision Inscription** (`201758373060805700`). Le groupe anciennement configuré avait disparu ; ce groupe a été recréé et la variable Netlify mise à jour. Aucun contact ni email de test n’a été créé/envoyé à cette occasion.
3. Après confirmation de l’enregistrement, le popup charge le checkout Spiffy natif : 41049 à 97 €, 41096 à 147 € après échéance.
4. Les automatisations Purchase existantes restent responsables du groupe **DeltaVision Acheteurs** (`201141494128576449`), de Circle et de la confirmation. Le navigateur ne peut pas déclarer un achat.

Les non-acheteurs sont **Inscription ET PAS Acheteurs**. Ne pas relancer tout le groupe Inscription sans cette exclusion. Aucune nouvelle séquence email n’est activée ; toute communication doit être validée séparément par Sonny.

## Spiffy

Le snippet `delta-vision-two-step-embed.html` a été ajouté aux deux checkouts, sans modifier leurs prix, coupons, accès ou automatisations. Il ne s’active que dans une iframe avec `dv_embed=2` et une origine parent autorisée. Le checkout direct reste inchangé.

L’ancienne capture email native est neutralisée uniquement dans ce mode intégré, puisque l’enregistrement a déjà été effectué par la première étape. Les champs carte restent entièrement hébergés par Spiffy/Stripe. Le prénom/email natifs sont préremplis et vérifiés avant masquage. Le montant réel Spiffy est contrôlé avant affichage.

Le montant est figé à l’ouverture de l’étape carte pour ne pas interrompre une saisie/3DS si le compteur expire. Une nouvelle tentative après échéance utilise 147 €. La limite déjà acceptée demeure : un ancien lien direct à 97 € peut encore fonctionner.

## Vérifications et publication

- `node scripts/delta-two-step-smoke.mjs`
- `node scripts/delta-vision-house-checkout-smoke.mjs`
- `node scripts/delta-vision-hosted-smoke.mjs`
- `npm run build`
- `node scripts/delta-mailerlite-readiness.mjs` (lecture seule par défaut)
- Tests visuels desktop/mobile sur les vrais champs Spiffy, sans soumettre de carte ni de paiement.

Le mode local `?popup=1&test-registration=1` simule seulement l’enregistrement des adresses `@example.com`, pour les tests visuels. Il est limité au développement et aux hôtes loopback ; il est éliminé du build de production. Ne pas y effectuer de paiement.

Le popup du site n’est pas publié en production à ce stade. La prévisualisation utilise les fonctions réelles et le groupe recréé. Un test de contact réel attend une adresse autorisée par Sonny ; le paiement final et le retour après achat restent à valider par un test acheteur autorisé.
