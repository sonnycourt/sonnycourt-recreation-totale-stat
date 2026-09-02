# Séquence email MC2 — fenêtre globale de 72 heures

## Statut de sécurité

Toutes les nouvelles automations et toutes les réécritures décrites ici doivent
rester **désactivées** tant que Sonny n'a pas validé chaque email. Aucun test ne
doit être envoyé à un vrai prospect.

L'automation existante `MC2 — Offre expirée — Downsell SSR`, déclenchée par le
groupe `MC2 — Offre vue — sans achat`, reste inchangée. Ce groupe ne doit jamais
servir à une relance avant expiration.

## Source de vérité et transitions

- L'offre et le replay expirent ensemble, 72 heures après l'heure annoncée de
  la session.
- La chronologie commerciale commence au CTA global de la session, même si le
  prospect découvre l'offre plus tard en replay.
- Un achat annule les jobs restants et retire le contact des groupes
  déclencheurs MC2.
- Tant que le CTA n'est pas atteint, un contact reçoit la séquence replay.
- Dès que le CTA est atteint, les rappels replay encore en attente sont ignorés
  et la séquence offre prend le relais à son étape chronologique réelle.
- Les jobs ont une clé unique par inscription, session et message : un retry ne
  peut pas déclencher un second email.

## Chronologie finale

| Audience | Moment | Type interne | Groupe MailerLite |
|---|---:|---|---|
| No-show | Session 11 h : 14 h ; session 20 h : lendemain 9 h | `no_show_initial` | MC2 — Replay — no-show |
| Parti avant CTA | 90 min après la dernière présence | `left_before_cta_initial` | MC2 — Replay — parti avant offre |
| Replay non terminé | Expiration - 24 h | `replay_24h` | MC2 — Replay — 24 heures restantes |
| Replay non terminé | Expiration - 4 h | `replay_4h` | MC2 — Replay — 4 heures restantes |
| Offre vue sans achat | CTA + 90 min | `offer_followup_90m` | MC2 — Offre — suivi 90 minutes |
| Offre vue sans achat | CTA + 12 h | `offer_consultations_12h` | MC2 — Offre — consultations 12 heures |
| Offre vue sans achat | CTA + 36 h | `offer_proof_36h` | MC2 — Offre — preuve 36 heures |
| Offre vue sans achat | CTA + 48 h | `offer_5_places` | MC2 — Offre — 5 places restantes |
| Offre vue sans achat | Expiration - 4 h | `offer_4h` | MC2 — Offre — 4 heures restantes |
| Offre vue sans achat | Expiration - 1 h | `offer_1h` | MC2 — Offre — 1 heure restante |
| Offre expirée sans achat | Expiration + 5 min | `offer_expired_downsell` | MC2 — Offre vue — sans achat |

Les emails CTA + 90 min, +12 h et +36 h sont mutuellement périmables : un
prospect qui découvre l'offre tard ne reçoit jamais une rafale d'anciens
messages. Il entre au message encore pertinent à ce moment-là.

## Emails à valider

### 1. No-show — accès replay

**Objet :** Tu as manqué le direct, pas la transformation

**Préheader :** Ton accès personnel est prêt.

Bonjour {$name},

Tu n'étais pas là au direct.

Mais tu n'as encore rien perdu — à condition de ne pas laisser passer aussi le
replay.

Cette masterclass te montre pourquoi vouloir plus fort ne suffit pas, et comment
reprogrammer ce qui te ramène aujourd'hui vers les mêmes blocages.

Je t'ai réservé un accès personnel. Il démarre au début de la masterclass et
reste disponible jusqu'à la fin de ton offre.

**CTA : JE REGARDE LA MASTERCLASS**

Lien : `{$mc2_replay_url}`

Le replay et l'offre expireront ensemble. Le compteur affiché sur ta page fait
foi.

Sonny 🦋

### 2. Parti avant le CTA — reprise exacte

**Objet :** Tu as quitté avant la partie la plus importante

**Préheader :** Ton replay reprend exactement là où tu t'es arrêté.

Bonjour {$name},

Tu as quitté la masterclass avant la partie où tout s'assemble.

Je t'ai donc préparé un accès personnel qui reprend exactement là où tu t'es
arrêté. Tu n'as rien à recommencer.

Ce serait dommage d'avoir investi ton temps pour t'arrêter juste avant de voir
comment appliquer concrètement la méthode à ta propre vie.

**CTA : JE REPRENDS LÀ OÙ JE ME SUIS ARRÊTÉ**

Lien : `{$mc2_replay_url}`

Ton replay reste accessible jusqu'à l'expiration affichée sur ta page.

Sonny 🦋

### 3. Replay — 24 heures restantes

**Objet :** Demain, ton accès disparaît

**Préheader :** Il te reste 24 heures pour aller jusqu'au bout.

Bonjour {$name},

Tu t'es inscrit à cette masterclass pour une raison.

Mais tant que tu ne vas pas jusqu'au bout, cette raison reste exactement au
même endroit : dans ta tête, pas dans ta vie.

Ton accès personnel disparaît dans 24 heures. Tu peux reprendre immédiatement,
sans recommencer ce que tu as déjà vu.

**CTA : JE TERMINE LA MASTERCLASS**

Lien : `{$mc2_replay_url}`

Sonny 🦋

### 4. Replay — 4 heures restantes

**Objet :** Plus que 4 heures pour voir la fin

**Préheader :** Après, le replay et l'offre disparaissent ensemble.

Bonjour {$name},

Dans 4 heures, ton replay et l'offre présentée à la fin disparaîtront ensemble.

Tu n'as pas besoin de dégager une nouvelle journée. Tu as seulement besoin de
reprendre là où tu en es et de décider après avoir vu toute la démonstration —
pas avant.

**CTA : JE VOIS LA FIN MAINTENANT**

Lien : `{$mc2_replay_url}`

Sonny 🦋

### 5. Offre — 90 minutes après le CTA

**Objet :** Tu n'as pas besoin d'être sûr

**Préheader :** Tu as besoin d'une décision que tu peux réellement tester.

Bonjour {$name},

Tu n'as pas besoin d'être certain qu'Esprit Subconscient 2.0 fonctionnera pour
toi avant de commencer.

Tu dois seulement décider si tu préfères continuer avec les mêmes automatismes,
ou tester sérieusement un système conçu pour les reprogrammer.

Tu disposes de 14 jours pour le faire sans prendre le risque de rester coincé
avec une décision qui ne te convient pas.

**CTA : JE COMMENCE MA TRANSFORMATION**

Lien : `{$mc2_offer_url}`

Sonny 🦋

### 6. Offre — consultations privées

**Objet :** Ce bonus disparaîtra en premier

**Préheader :** Les consultations privées ont leur propre limite.

Bonjour {$name},

Il y a une différence entre recevoir une méthode et être accompagné au moment
précis où tes anciens réflexes essaient de reprendre le dessus.

C'est pourquoi les trois séances individuelles avec l'un de nos coachs font
partie de l'offre de lancement.

Mais elles sont limitées séparément : quand leur compteur atteint zéro, Esprit
Subconscient 2.0 reste accessible aux dernières places — sans ces trois séances.

Si cet accompagnement compte pour toi, regarde le nombre réellement restant sur
ta page avant de décider d'attendre.

**CTA : JE VÉRIFIE LES PLACES RESTANTES**

Lien : `{$mc2_offer_url}`

Sonny 🦋

### 7. Offre — preuve et peur de regretter

**Objet :** La vraie peur de Chantal

**Préheader :** Ce n'était ni l'argent, ni le temps.

Bonjour {$name},

La peur de Chantal avant son inscription, ce n'était pas l'argent, le temps ou
même l'énergie.

Elle avait peur de regretter. D'avoir encore cru en une solution, puis de finir
déçue en ne voyant rien changer.

Ce qui a fait la différence n'a pas été une motivation parfaite. C'est d'avoir
un système qui la maintienne précisément là où, seule, elle aurait abandonné.

Si ta peur ressemble à la sienne, ne la confonds pas avec une preuve que tu dois
rester au même endroit.

**CTA : JE DÉCOUVRE ESPRIT SUBCONSCIENT 2.0**

Lien : `{$mc2_offer_url}`

Sonny 🦋

### 8. Offre — 5 places restantes

**Objet :** Il reste 5 places

**Préheader :** Le compteur est passé de 37 à 5.

Bonjour {$name},

Je vais droit au but.

Quand l'offre est apparue, il restait 37 places sur 100.

Il en reste maintenant 5.

Les consultations privées offertes sont déjà parties. Quand ces cinq dernières
places disparaîtront à leur tour, il ne restera rien à réserver.

Si tu sais que tu veux arrêter de tourner en rond, attendre davantage n'améliore
plus ta décision. Cela réduit seulement tes options.

**CTA : JE PRENDS L'UNE DES 5 DERNIÈRES PLACES**

Lien : `{$mc2_offer_url}`

Sonny 🦋

### 9. Offre — 4 heures restantes

**Objet :** Plus que 4 heures

**Préheader :** Après, cette offre disparaît pour de bon.

Bonjour {$name},

Dans 4 heures, ton offre expire.

1997 € peut sembler être un gros investissement. Mais ne pas t'inscrire et
continuer à faire ce que tu as fait jusqu'à maintenant peut devenir la décision
qui te coûte le plus cher : en temps, en énergie et en occasions que tu ne
récupéreras pas.

Tu n'as pas besoin d'une certitude parfaite. Tu as besoin d'une décision avant
que le choix disparaisse.

**CTA : JE COMMENCE MA TRANSFORMATION**

Lien : `{$mc2_offer_url}`

Sonny 🦋

### 10. Offre — 1 heure restante

**Objet :** Dans 1 heure, c'est terminé

**Préheader :** Ton lien personnel expirera avec l'offre.

Bonjour {$name},

Dans une heure, ton accès à l'offre disparaîtra.

Je ne vais pas inventer un nouvel argument à la dernière minute. Tu as vu la
méthode, l'accompagnement, les bonus et la garantie de 14 jours.

Il ne reste qu'une question : est-ce que tu veux continuer comme avant, ou
prendre aujourd'hui la décision qui peut enfin changer la suite ?

**CTA : JE PRENDS MA DÉCISION**

Lien : `{$mc2_offer_url}`

Sonny 🦋

## Variables d'environnement à renseigner avant activation

```text
MAILERLITE_GROUP_MC2_OFFER_FOLLOWUP_90M=
MAILERLITE_GROUP_MC2_OFFER_CONSULTATIONS_12H=
MAILERLITE_GROUP_MC2_OFFER_PROOF_36H=
MAILERLITE_GROUP_MC2_REPLAY_24H=
MAILERLITE_GROUP_MC2_REPLAY_4H=
```

Les identifiants des groupes existants doivent être repris tels quels. Aucun
groupe historique ne doit être recréé.

## Contrôle final dans MailerLite

1. Vérifier que les cinq nouveaux groupes existent une seule fois.
2. Vérifier que chaque automation a pour unique déclencheur « rejoint le
   groupe », sans délai interne MailerLite.
3. Vérifier que « Répéter l'automation » est désactivé.
4. Vérifier que les cinq nouvelles automations sont désactivées.
5. Vérifier les objets, préheaders, expéditeur et adresse de réponse.
6. Cliquer chaque CTA en prévisualisation et confirmer la variable attendue.
7. Vérifier sur mobile et desktop qu'aucun bouton n'est tronqué.
8. Vérifier que le downsell SSR existant n'a subi aucune modification.
9. Après validation de Sonny, exécuter le SQL idempotent, renseigner les IDs de
   groupes, puis seulement activer les flags backend et les automations.
10. Tester avec des contacts internes uniquement : no-show, départ avant CTA,
    offre vue, achat avant échéance et expiration sans achat.
