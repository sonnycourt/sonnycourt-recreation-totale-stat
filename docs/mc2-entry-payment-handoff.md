# MC2 — entrée à 27 € — état au 25 septembre 2026

## État réel

- Travail isolé : branche `codex/mc2-masterclass-27-eur`, base `fb02ee6`.
- Aucune modification du site de production.
- Migration `sql/mc2_masterclass_entry_payment.sql` exécutée par Sonny, colonnes vérifiées en lecture seule.
- Produit Spiffy 11870, checkout 40689, paiement unique de 27 EUR, publié avec autorisation explicite de Sonny.
- URL : https://sonnycourt.spiffy.co/checkout/masterclass-es2-27
- Thank You : https://sonnycourt.com/mc2/confirmation/ ; détails de commande transmis, données de contact dans l’URL désactivées.
- Le parent de l’iframe ajoute `?t=TOKEN` au retour. La confirmation vérifie le paiement côté serveur avant accès.
- Spiffy : Stripe activé, PayPal désactivé, pas d’adresse de facturation, contact email uniquement, CGV natives obligatoires, bouton français.
- Aucun paiement réel ni envoi client de test effectué. Aucune automation de checkout/produit ajoutée.

## Vérifié

- Champ carte présent dans le checkout Spiffy autonome.
- API Spiffy `orders?include=checkout` fournit bien le checkout ; montants en unités mineures.
- Tests entrée 27 EUR, pays/inscriptions, opt-in Meta, webhook ES2 existant, récupération d’accès, replay (segmentation/worker/scheduler), loader historique : passent.
- Capture prénom/email conservée dès l’étape email, sans attendre le téléphone.
- Nouveaux inscrits restent partiels avant paiement ; pas de rappels session/replay avant paiement.
- Accès historiques conservés (`entry_payment_required=false`).
- Paiement refusé, remboursé, manuel, autre montant/devise/checkout/client : aucun accès confirmé.
- Référence de commande unique + mise à jour conditionnelle ; reprises de queues idempotentes.
- Build Astro réussi.

## Restant avant toute mise en ligne

1. Test local d’iframe Spiffy : le formulaire intégré reste caché (pas de ready/height/onload observé), alors que le checkout autonome charge. Cause non établie. Ne pas déclarer l’intégration validée.
2. Préremplissage email du checkout autonome non observé avec les paramètres de test ; vérifier le comportement intégré ou employer l’API officielle `checkout.ready` / `checkout.set('field','email',...)` si nécessaire.
3. Vérifier que le webhook global Spiffy couvre aussi checkout 40689. La vérification au retour fonctionne indépendamment, mais le webhook doit couvrir la fermeture prématurée du navigateur.
4. Prévisualisation Netlify bloquée par les repères historiques « accès offert » de `deploy/critical-routes.json` pour `/masterclass` et `/masterclass/` (redirections vers MC2).
   - Modification proposée : conserver toutes les routes, remplacer uniquement les deux libellés par les nouveaux titre/CTA, ajouter `entry-payment-step`.
   - Auto-review a refusé la modification ; une demande d’autorisation explicite a été envoyée à Sonny, réponse encore attendue. Ne pas contourner le contrôle.
5. Deux anciens smoke tests échouent sur des attentes sans rapport avec le paiement d’entrée : `mc2-session-emails-smoke` attend un CTA à +1 seconde ; `mc2-session-inline-checkout-smoke` attend un ancien texte 1 997 EUR absent de la base. Ne pas présenter toute la suite comme verte.
6. Renforcer le test de la confirmation 402 → validation paiement → même token, et le test du webhook entrée isolé.
7. Revue visuelle desktop/mobile des deux pages MC2/Meta. Puis test de paiement réel uniquement effectué/autorisé explicitement par Sonny.
8. Production uniquement après validation, fusion explicite dans main propre synchronisé, via `npm run deploy:production`.

## Serveurs / fichiers

- Serveur local de cette tâche : http://127.0.0.1:4384/mc2/?preview=dev&entry_payment_preview=1 (backend simulé ; ne pas payer dans ce mode).
- Code d’habillage enregistré dans Spiffy : `spiffy/mc2-entry-embedded.html` (une ligne de commentaire omise côté Spiffy, fonctionnellement identique).
- Aucun secret nouveau ni modification Stripe.

## Attention pendant les tests

Le checkout autonome est public mais le serveur en production n’a pas encore le nouveau traitement d’entrée : ne pas y effectuer un achat de test avant d’avoir raccordé le serveur. Ne jamais tester avec un email client réel.
