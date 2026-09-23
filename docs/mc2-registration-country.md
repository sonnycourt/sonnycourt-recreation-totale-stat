# MC2 registration phone-country gate

The shared `/mc2/` and `/meta/mc2/` form validates the international phone
number via `check-mc2-phone-country` before showing the commitment step.
`register-mc2` repeats the check before creating/updating a new registration.
The selected flag, submitted `pays` and IP do not grant eligibility.

Allowed: FR CH BE CA LU RE GP MQ GF PF NC. Country parsing uses pinned
libphonenumber-js/max metadata, including NANP area codes (Canada vs US/DO).
Invalid/non-geographic/undetermined numbers fail closed with a retry message.

No step-1 partial capture: email/SMS/CAPI registration events and access tokens
are created only on final eligible registration. Anonymous optin step metrics
remain available. Existing completed registrations and access links are unchanged.
No database schema changes, payment settings, new email/SMS or €27 redirect.

This identifies the numbering territory, not residence/card origin or ownership.
Shared +590 mobile numbering cannot reliably separate GP from MF/BL.
Sonny explicitly approved accepting those shared mobile numbers on 2026-09-23;
they are classified as GP by the phone library. No IP override is applied.

Tests: `npm run test:mc2-registration-country`, `node scripts/mc2-meta-optin-smoke.mjs --built`.
