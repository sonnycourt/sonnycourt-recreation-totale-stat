# ES2 premium — aperçu après achat Delta Vision

Route : `/es2-offre-premium/`.

Cette première version reprend `DealOfferDraftX.astro`, le composant réellement
utilisé sur MC2 Session. Aucun composant partagé n’a été modifié. Prix conservés :
1 297 € en une fois ou 12 × 197 €. Les cinq bonus sont présents.

Ajouts : confirmation visuelle Delta Vision, confettis pendant cinq secondes
(désactivés si réduction des animations), vidéo placeholder, introduction ES2,
lien permettant de rejoindre Delta Vision sans accepter l’offre.

## État volontairement limité à la maquette

- Aucune vérification d’achat réelle ; la confirmation est explicitement simulée.
- Aucun paiement : interception des CTA vers un dialogue de présentation, CSP
  bloquant les iframes et les soumissions de formulaires.
- Aucune modification de la redirection Spiffy ou des automatisations.
- Aucun compteur de places / délai MC2 sur cette route indépendante.
- Le bonus consultation est reproduit depuis l’offre MC2, mais sa disponibilité
  réelle doit être validée avant d’activer ce nouveau parcours.
- `noindex,nofollow,noarchive`.

## Avant une publication fonctionnelle

1. Ajouter la vidéo approuvée.
2. Valider les conditions et le tarif de l’upsell, ainsi que ses bonus disponibles.
3. Vérifier côté serveur l’achat Delta Vision avant d’afficher une confirmation.
4. Raccorder le paiement et les accès ES2 au parcours validé, sans dupliquer
   les achats ni les automatisations. Retirer alors les protections de maquette
   uniquement pour les sources et actions explicitement autorisées.
5. Tester puis valider la redirection post-achat séparément.

Vérification : `npm run build && node scripts/es2-premium-preview-smoke.mjs`.
