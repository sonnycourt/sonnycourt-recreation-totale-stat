# MC2 — emails de session et rareté après CTA

## Logique

- Toute inscription complète, JIT ou programmée : confirmation immédiate.
- Créneau programmé à 11 h ou 20 h : rappel H-1.
- Inscription moins de 65 minutes avant : pas de rappel H-1 en doublon.
- Anti-doublon : `token + session + type`.
- Session déplacée : l'ancien job est ignoré.
- CTA atteint pendant le live : six jobs sont créés sur l'échéance globale de
  la session.
- Premier CTA atteint en replay : six jobs personnels sont créés depuis ce CTA,
  avec une échéance égale à 72 h moins la durée de vidéo précédant le CTA.
- Séquence de conversion : CTA + 90 min, +12 h et +36 h.
- « 5 places restantes » : 48 heures après le premier CTA, exactement au palier
  de la timeline visible.
- « 4 heures restantes » et « 1 heure restante » : respectivement H-4 et H-1.
- Un acheteur est exclu juste avant l'ajout au groupe. Une relance devenue
  obsolète est ignorée au lieu d'être envoyée en retard.

## Champs MailerLite

- `{$mc2_confirmation_url}`
- `{$mc2_session_url}`
- `{$mc2_session_local_label}`
- `{$mc2_offer_url}`
- `{$mc2_offer_expires_at}`

## Groupes MailerLite de rareté

- `MC2 — Offre — suivi 90 minutes`
- `MC2 — Offre — consultations 12 heures`
- `MC2 — Offre — preuve 36 heures`
- `MC2 — Offre — 5 places restantes`
- `MC2 — Offre — 4 heures restantes`
- `MC2 — Offre — 1 heure restante`

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
MAILERLITE_GROUP_MC2_OFFER_FOLLOWUP_90M=
MAILERLITE_GROUP_MC2_OFFER_CONSULTATIONS_12H=
MAILERLITE_GROUP_MC2_OFFER_PROOF_36H=
MAILERLITE_GROUP_MC2_OFFER_5_PLACES=
MAILERLITE_GROUP_MC2_OFFER_4H=
MAILERLITE_GROUP_MC2_OFFER_1H=
MC2_OFFER_EMAILS_ENABLED=false
```
