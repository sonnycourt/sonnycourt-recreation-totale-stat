# MC2 — confirmation et rappel de session

## Logique

- Toute inscription complète, JIT ou programmée : confirmation immédiate.
- Créneau programmé à 11 h ou 20 h : rappel H-1.
- Inscription moins de 65 minutes avant : pas de rappel H-1 en doublon.
- Anti-doublon : `token + session + type`.
- Session déplacée : l'ancien job est ignoré.

## Champs MailerLite

- `{$mc2_confirmation_url}`
- `{$mc2_session_url}`
- `{$mc2_session_local_label}`

## Emails validés

### Confirmation immédiate

Objet : Ta place est réservée

Ta place pour la masterclass est réservée pour
`{$mc2_session_local_label}`.

Prépare ta session ici :
`{$mc2_confirmation_url}`

Tu peux revenir à tout moment avec ce même lien.

### Rappel H-1

Objet : La masterclass commence dans 1 heure

La masterclass commence dans 1 heure.

Rejoins ta session ici :
`{$mc2_session_url}`

## Variables

```text
MC2_SESSION_EMAILS_ENABLED=true
MAILERLITE_GROUP_MC2_CONFIRMATION=
MAILERLITE_GROUP_MC2_SESSION_REMINDER_1H=
```
