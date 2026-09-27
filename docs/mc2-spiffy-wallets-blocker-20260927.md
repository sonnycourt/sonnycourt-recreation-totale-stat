# Apple Pay / Google Pay dans le checkout MC2 — vérification du 27 septembre 2026

## État

Non débloqué. Aucun code du checkout, réglage Spiffy/Stripe ou site en production
n’a été modifié pendant cette investigation. Aucun paiement, acceptation des CGV
ou envoi client n’a été effectué. Le test temporaire est distinct du site.

## Constats vérifiés

- Les checkouts 40007 (paiement unique) et 40006 (12 mensualités) utilisent le
  même compte Stripe Spiffy. Le connecteur Stripe disponible vise un autre
  compte : il n’a pas été utilisé pour modifier des réglages.
- Le Dashboard du compte effectivement utilisé par Spiffy liste
  `sonnycourt.com` et `sonnycourt.spiffy.co` parmi les domaines de moyens de
  paiement activés. Cela ne constitue pas un test de paiement Apple/Google Pay.
- `src/lib/mc2-draftx-spiffy.mjs` applique déjà `allow="payment"` à l’iframe.
- L’interface Settings des deux checkouts propose Stripe et PayPal activés,
  mais aucun réglage d’activation des wallets pour l’intégration Elements.
- Le bundle public actuel `/_nuxt/675d495.js` initialise le Payment Request
  Button seulement si cette condition est vraie :

  ```js
  this.allowPaymentRequest && !this.isEditor && !this.isInternal &&
    (!this.isElements || this.elements.allowPaymentRequest)
  ```

- En mode Elements, les données servies par Spiffy contiennent `modality`,
  `uid`, `from`, `cookies`, `config`, `handles`, mais pas `allowPaymentRequest`.
  Une requête GET avec ce paramètre à `true` donne le même état normalisé sans
  ce paramètre sur les deux checkouts. Le normaliseur client observé dans
  `/_nuxt/a5c55d2.js` ne le conserve pas non plus.
- Charger l’URL hébergée sans `elements` dans la même iframe a été testé dans
  Chrome : le navigateur affiche « sonnycourt.spiffy.co n’autorise pas la
  connexion ». La réponse hébergée porte `X-Frame-Options: SAMEORIGIN` ; la
  réponse Elements ne porte pas cet en-tête.
- Aucun contournement des en-têtes de sécurité, proxy du formulaire, écrasement
  d’état Vue privé ou remplacement du traitement financier Spiffy n’a été mis
  en place.

## Limites

Pas de confirmation Apple Pay / Google Pay sur un appareil éligible, pas de
transaction et pas de validation des upsells/retours post-paiement dans un mode
modifié. L’absence de wallet dans Chrome seul n’a pas été utilisée pour
conclure à une incompatibilité.

Stripe documente bien la prise en charge moderne des wallets dans une iframe
sous conditions (notamment Safari 17+, domaines enregistrés et permission de
paiement pour Apple Pay cross-origin). Ce n’est donc pas une impossibilité
générale de Stripe : il reste un blocage dans le mode d’intégration Spiffy testé.

Sources :
- https://docs.stripe.com/testing/wallets?ui=payment-request-button-element
- https://docs.stripe.com/payments/payment-methods/pmd-registration
- https://university.spiffy.co/quick-find/does-spiffy-support-apple-pay/
- https://developers.spiffy.co/js-api/overview

## Demande au support Spiffy — envoyée le 27 septembre 2026

Envoi autorisé explicitement par Sonny, effectué via « Contact Us » dans
l’application Spiffy (Help Scout Beacon). Confirmation affichée : « We’re on
it! ». Le support annonce une réponse par email généralement sous 24 heures.
Aucun numéro de ticket n’a été affiché sur la confirmation.

L’envoi ne signifie pas que les wallets sont déjà débloqués.

Subject: Enable Apple Pay / Google Pay in embedded checkouts 40006 and 40007

Hello Spiffy team,

We need Apple Pay and Google Pay inside our existing checkout iframe on
https://sonnycourt.com, while keeping Spiffy order processing, payment plans,
upsells and post-purchase redirects. The relevant checkouts are 40006 and 40007.
Customers must remain on our website, without being redirected to a standalone
checkout.

The iframe already has `allow="payment"`. Both `sonnycourt.com` and
`sonnycourt.spiffy.co` are listed as enabled payment method domains on the
Stripe account actually connected to these Spiffy checkouts.

In the current public checkout code, the Stripe Payment Request Button is gated
by `!isElements || elements.allowPaymentRequest`. However, `allowPaymentRequest`
is not retained in the normalized Elements configuration, even when supplied as
true in the encoded `elements` URL parameter. We found no corresponding setting
in either checkout’s Settings page.

Loading the hosted checkout URL without Elements inside the iframe is blocked
by `X-Frame-Options: SAMEORIGIN`, so we have not used that route or altered any
security headers.

Could you enable the supported embedded-wallet option for this account, or
provide the supported integration/configuration that preserves Spiffy’s native
validation, order creation, upsells and parent-page redirect? Please confirm
Apple Pay and Google Pay support separately, including browser requirements.
If necessary, please escalate this to your technical team.

Checkout URLs:
- https://sonnycourt.spiffy.co/checkout/esprit-subconscient-2-0-34-1
- https://sonnycourt.spiffy.co/checkout/esprit-subconscient-2-0-2-2-1-1

Thank you,
Sonny Court
