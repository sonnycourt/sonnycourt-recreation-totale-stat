# MC2 — récupération replay et offre

## État de sécurité

- Aucun envoi direct n'est codé.
- MailerLite ne reçoit un contact dans un groupe déclencheur que si
  `MC2_REPLAY_RECOVERY_ENABLED=true`.
- Cette variable doit rester `false` jusqu'à relecture finale de chaque email.
- Aucun déploiement n'a été effectué.
- La migration est dans `sql/mc2_replay_recovery.sql` et doit être exécutée
  manuellement par Sonny.

## Segmentation au moment exact de l'envoi

| Segment | Condition de vérité | Délai par défaut | Destination |
| --- | --- | --- | --- |
| No-show | `attended_live=false`, non acheteur | 14 h après une session de 11 h ; 9 h le lendemain après une session de 20 h | Replay personnel jusqu'à l'échéance globale du replay |
| Parti avant CTA | `attended_live=true`, `saw_offer=false`, non acheteur | dernière présence + 90 min | Replay jusqu'à son échéance globale, reprise au point live moins 20 min |
| Replay non terminé | `saw_offer=false`, non acheteur | échéance replay - 24 h puis - 4 h | Même replay personnel |
| Offre vue | `saw_offer=true`, non acheteur | expiration de l’offre + 5 min | Offre directe, sans replay |
| Acheteur | statut/paiement/`purchased_at` | immédiat | Toute relance annulée et groupes retirés |

Le worker revalide le segment et l'achat juste avant chaque livraison. Une
évolution du comportement invalide automatiquement un ancien job.

## Idempotence et anti-doublon

La clé métier est :

`token + date de session + type de message`

Supabase impose son unicité. Le worker réclame atomiquement le job et libère un
job bloqué en `processing` après cinq minutes. Il effectue au maximum cinq
tentatives techniques.

La date de session est aussi figée dans le job. Si le prospect déplace sa
session, l'ancien job est annulé au moment de l'envoi et le nouveau créneau
produit une nouvelle clé métier.

## Accès replay

- La page `/mc2/replay/` réutilise fidèlement le HTML, le CSS, le lecteur HLS,
  les états responsive et le watchdog anti-freeze de `/masterclass/replay/`.
  Aucun nouveau design ni nouvelle direction artistique n'a été introduit.
- Code opaque aléatoire de 192 bits ; le token d'inscription n'est pas exposé.
- L'accès replay expire 72 heures après la session, indépendamment de l'offre.
- Si le CTA est atteint en replay, une échéance commerciale personnelle est
  créée à partir de ce CTA, après déduction de la durée de vidéo déjà vue.
- Un achat invalide aussi l'accès replay.
- L'URL vidéo et la seconde du CTA viennent des variables d'environnement.

## Variables

Obligatoires avant activation :

```text
MC2_REPLAY_RECOVERY_ENABLED=false
MC2_REPLAY_VIDEO_URL=
MC2_REPLAY_CTA_SECONDS=4740
MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW=
MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA=
MAILERLITE_GROUP_MC2_OFFER_SEEN=
MAILERLITE_GROUP_MC2_REPLAY_24H=
MAILERLITE_GROUP_MC2_REPLAY_4H=
MAILERLITE_GROUP_MC2_BUYERS=
```

Après relecture des messages, le script
`scripts/setup-mc2-replay-mailerlite.mjs` peut retrouver ou créer idempotemment
les cinq groupes et les cinq champs nécessaires. Il ne crée aucune automation et
n'envoie aucun email.

Valeurs optionnelles avec défauts :

```text
# Override facultatif ; vide = timing intelligent 14 h / lendemain 9 h
MC2_REPLAY_NO_SHOW_DELAY_MINUTES=
MC2_REPLAY_BEFORE_CTA_DELAY_MINUTES=90
MC2_OFFER_FOLLOWUP_DELAY_MINUTES=5
MC2_LIVE_COUNTDOWN_SECONDS=1200
MC2_PUBLIC_BASE_URL=https://sonnycourt.com
```

## Messages à relire avec Sonny avant activation

La chronologie, les dix textes de travail et la checklist de validation sont
centralisés dans `docs/MC2_EMAIL_AUTOMATIONS_72H.md`. Le downsell SSR existant
reste séparé et inchangé.

## Audit du tracking existant

- `session_joined` met `attended_live=true` et est émis au clic réel qui lance
  le lecteur : signal fiable de présence volontaire.
- `cta_reached` met `saw_offer=true` lorsque le CTA devient actif : fiable pour
  distinguer l'offre vue, à condition de conserver la seconde CTA synchronisée.
- `mc2-presence` met à jour `watch_max_seconds_live`. Le replay retirant les
  20 min d'attente présentes uniquement dans le live, le point de reprise
  est `max(0, watch_max_seconds_live - 1200)`.
- Le worker crée le contact MailerLite seulement au moment d'une relance due,
  avec le flag actif, puis l'ajoute uniquement au groupe MC2 revalidé. Il ne
  touche à aucun groupe historique du webinaire.
- Stripe met `statut=purchased`, `payment_status=paid` et `purchased_at`; le
  worker revalide ces trois signaux avant toute livraison, annule les jobs
  restants et retire les groupes déclencheurs.
