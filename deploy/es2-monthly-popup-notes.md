# ES2 monthly popup — 2026-10-20

The five monthly CTAs use the native Spiffy popup for checkout 41175:
https://sonnycourt.spiffy.co/checkout/offre-delta-es2

Only the modal shell is styled on the site. Spiffy retains its payment iframe,
validation, Stripe/PayPal processing and existing automations. No card data is
read or stored by the parent page. A saved Delta Vision card is not guaranteed
to be reusable in this independent checkout.

## Dedicated checkout presentation corrections applied in Spiffy

- Custom CSS: replace `input[placeholder="Email"]` selectors with
  `input[type="email"]`; the actual placeholder is `email@domain.com`.
  This restores the required first-name/email section.
- Reduce that section's bottom margin to 18px.
- Custom Tracking Code presentation text only: replace the inherited
  `3 paiements de 767 €` summary with `12 mensualités de 197 €`, total
  `2 364 €`, and `197 € prélevés aujourd’hui, puis 11 prélèvements mensuels de 197 €.`
- Show `.es2-inline-plan` and use readable light-theme summary/security colors.
- Actual payment schedule was already 197 EUR today plus 11 monthly payments;
  no price, payment plan, automation or customer record was modified.

## Release boundary

The native one-time accept and decline links are now connected through SpiffyJS.
Both purchased branches must forward to `/es2-premium-confirmation/`, with order
and contact details enabled. The decline branch remains `/delta-vision/merci/`.
The independent confirmation verifies the order with Spiffy before accepting
address submissions, and then forwards to `/masterclass/success/` (Romain).
Addresses are immutable private submissions in Netlify Blobs `es2-premium-billing`,
not updates to MC2 registrations or existing CRM notes. This is payment verification,
not an account authentication mechanism: it discloses no stored customer information
and grants no access. Integrating those submissions into an administrative view is
separate work; do not describe them as automatically synchronized into the CRM.
No real purchase, card entry, CGV acceptance or email was used for testing.

## Confirmation repair — 2026-10-21

- Native acceptance step 98031 on checkout 41049 now includes contact details;
  checkout 41175 already included them. No price or automation is changed here.
- Confirmation recovers a missing email through an email-only form, retains the
  order in the URL for reloads and removes personal URL parameters immediately.
- Native payment verification checks the ES2 upsell line and its linked payment,
  not just an unrelated successful charge on the same Delta order.
- The sole low-price exception is verified order 2554891, customer 1909343,
  ES2 price 881271 and payment 4900437 for 150 cents. Other test purchases are
  not automatically admitted. Normal amounts remain 129700 / 19700 cents.
- Real Spiffy read-only verification passed for that existing test purchase.
  A local browser run completed missing-email recovery, address submission to
  memory-only storage and navigation to `/masterclass/success/` with Romain's
  WhatsApp link. No fictitious address was written to production.

Build and `node scripts/es2-premium-preview-smoke.mjs` pass. Browser checks cover
opening the actual iframe and its required fields/197 EUR schedule. A completed
purchase and post-payment access/automations have not been tested.

## Returning-buyer field cleanup — 2026-10-21

Spiffy replaces its email input with a returning-customer summary. The inherited
CSS depended on `:has(input[type="email"])`; when that input disappeared, dark
first-name, country and MC2-token fields reappeared.

Applied only to checkout 41175 and published through the Spiffy editor:

- Native country block 373134 and MC2-token block 373135 removed from the form.
  No customer field definition, existing customer value or order was deleted.
  Country remains collected by the post-payment billing-address form.
- First-name block 373132 made optional and hidden (not disabled or overwritten).
  Existing provider identity is preserved; no invented first name is supplied.
- Appended `spiffy-es2-monthly-identity-cleanup.css` after existing custom CSS.
  Identity spacing and light email fallback no longer depend on an email input
  being present. Keep the provider's recognised-customer summary/change action.
- The email fallback remains when Spiffy does not recognise the buyer. Never hide
  a required blank email or treat an email/name as authentication.
- No payment prices, schedule, automations, redirects or MC2 checkout changed.
  The checkout was still at the owner's temporary test price (1.48 EUR today)
  during this correction; the existing marketing recap remains 197 EUR. Restore
  the actual price before reopening the funnel, separately from this visual fix.
- Published DOM verification: name optional and hidden, country/token absent,
  native card iframe and required CGV still present. No payment was submitted.

## Monthly test confirmation — 2026-10-21

Order 2554945 was independently verified through the read-only Spiffy API:
checkout 41175, customer 1909375, ES2 item 4968860 / price 881386,
linked payment 4900527 succeeded for 148 cents with zero refund. Its test
product amount was 1500 cents. An exact-order exception now admits this existing
test, alongside the previously approved native test; normal monthly verification
still requires 19700 cents. No new arbitrary low-price test order is admitted.

Finalised non-matching payments no longer trigger repeated polling. Pending
verification is limited to three attempts and every browser request has a
12-second timeout, followed by recovery/help text rather than a stuck loader.
Tests: `es2-premium-billing-smoke.mjs` and
`es2-premium-confirmation-smoke.mjs`. No customer details were saved or emails sent.
