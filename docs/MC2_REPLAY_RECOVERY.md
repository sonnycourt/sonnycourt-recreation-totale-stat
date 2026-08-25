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
| No-show | `attended_live=false`, non acheteur | session + 22 h | Replay personnel 48 h |
| Parti avant CTA | `attended_live=true`, `saw_offer=false`, non acheteur | fin de session + 60 min | Replay 48 h, reprise au point live moins 20 min |
| Offre vue | `saw_offer=true`, non acheteur | fin de session + 15 min | Offre directe, sans replay |
| Acheteur | statut/paiement/`purchased_at` | immédiat | Toute relance annulée et groupes retirés |

Le worker revalide le segment et l'achat juste avant chaque livraison. Une
évolution du comportement invalide automatiquement un ancien job.

## Idempotence et anti-doublon

La clé métier est :

`token + date de session + segment`

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
- Fenêtre réelle de 48 heures, validée côté serveur à chaque chargement et à
  chaque événement de progression.
- Un achat invalide aussi l'accès replay.
- L'URL vidéo et la seconde du CTA viennent des variables d'environnement.

## Variables

Obligatoires avant activation :

```text
MC2_REPLAY_RECOVERY_ENABLED=false
MC2_REPLAY_VIDEO_URL=
MC2_REPLAY_CTA_SECONDS=4648
MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW=
MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA=
MAILERLITE_GROUP_MC2_OFFER_SEEN=
MAILERLITE_GROUP_MC2_BUYERS=
```

Après relecture des messages, le script
`scripts/setup-mc2-replay-mailerlite.mjs` peut créer idempotemment les trois
groupes et les cinq champs nécessaires. Il ne crée aucune automation et
n'envoie aucun email.

Valeurs optionnelles avec défauts :

```text
MC2_REPLAY_NO_SHOW_DELAY_MINUTES=1320
MC2_REPLAY_BEFORE_CTA_DELAY_MINUTES=60
MC2_OFFER_FOLLOWUP_DELAY_MINUTES=15
MC2_REPLAY_ACCESS_HOURS=48
MC2_LIVE_COUNTDOWN_SECONDS=1200
MC2_PUBLIC_BASE_URL=https://sonnycourt.com
```

## Messages à relire avec Sonny avant activation

Les contenus restent dans les automations MailerLite, pas dans le code.

### Brouillons de travail désactivés

**No-show**

Objet : Ta masterclass est disponible pendant 48 h

Tu n'as pas pu être là ? Ton accès personnel au replay est prêt. Il restera
disponible pendant 48 heures : `{$mc2_replay_url}`

**Présent, parti avant le CTA**

Objet : Reprends là où tu t'es arrêté

Ton replay reprend près de ton dernier point regardé. Ton accès personnel reste
disponible pendant 48 heures : `{$mc2_replay_url}`

**Offre vue, sans achat**

Objet : Esprit Subconscient 2.0

Tu as vu l'offre pendant la masterclass. Si une question t'a retenu, réponds à
cet email. Tu peux aussi reprendre ta décision ici : `{$mc2_offer_url}`

Ces textes sont uniquement des brouillons de relecture. Aucun d'eux n'est créé
dans MailerLite ni envoyé par le code.

- [ ] Email no-show : objet, texte, bouton et rappel de l'expiration 48 h.
- [ ] Email abandon avant CTA : objet, formulation du point de reprise et bouton.
- [ ] Email offre vue sans achat : objet, urgence et bouton offre.
- [ ] Vérifier expéditeur, adresse de réponse et désinscription.
- [ ] Vérifier les délais : 22 h / 60 min / 15 min.
- [ ] Vérifier l'URL vidéo et la seconde exacte du CTA.
- [ ] Test sandbox avec trois contacts réservés, puis contrôle de l'exclusion acheteur.
- [ ] Seulement après ces validations : passer le flag à `true`.

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
  worker revalide ces trois signaux avant toute livraison.
