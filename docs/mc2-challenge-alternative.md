# MC2 alternative offer

New contacts whose parsed phone country is outside the approved allowlist are
saved only to `public.mc2_challenge_contacts`, keyed by normalized email.
They are redirected with `location.replace` to `/challenge-transformation-offre/`.
No PII is put in the URL, no MC2 registration/token is created, no MailerLite
subscription or webinar reminder is sent. Existing completed registrations and
their access remain unchanged. No historical MailerLite deletion is performed.

The SQL in `sql/mc2_challenge_contacts.sql` is executed by Sonny. RLS is enabled;
anonymous/authenticated roles have no table access. Service role inserts only.
Both the phone check and final registration guard enforce persistence. Failure
returns a neutral retry response instead of claiming successful capture.
Repeated requests are idempotent (`ON CONFLICT email DO NOTHING`).

The dedicated offer is copied from Court-Circuit success, without its registration
confirmation banner. All offer markup/prices/Spiffy links remain identical.
The fullscreen notice uses Sonny's approved text, with no reopening/email promise.
Its dismissal starts the five-minute offer timer; storage keys are isolated from
the original page. The original Court-Circuit page is untouched.

Tests: `node scripts/mc2-challenge-contacts-smoke.mjs`,
`npm run test:mc2-registration-country`, `node scripts/mc2-meta-optin-smoke.mjs --built`.
