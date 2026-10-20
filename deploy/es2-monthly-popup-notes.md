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

The site remains a preview. One-time and decline handlers are intentionally
unchanged. The one-time button in this source still opens the old simulation;
do not mistake a configured Spiffy native offer for a live site integration.
No real purchase, card entry, CGV acceptance or email was used for testing.

Build and `node scripts/es2-premium-preview-smoke.mjs` pass. Browser checks cover
opening the actual iframe and its required fields/197 EUR schedule. A completed
purchase and post-payment access/automations have not been tested.
