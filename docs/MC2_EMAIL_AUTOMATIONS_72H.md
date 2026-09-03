# MC2 — emails, automations et chronologie directe/replay

Dernier audit : **3 septembre 2026**

Ce fichier est la source de vérité à relire avant toute activation. Il regroupe
la chronologie, les dix emails, les identifiants MailerLite et la procédure de
mise en ligne.

## Statut de sécurité

- Les dix nouveaux workflows MailerLite sont complets et **désactivés**.
- Aucun email de cette nouvelle séquence n'a été envoyé à un prospect.
- Les cinq workflows historiques restent actifs jusqu'au basculement final.
- Les cinq remplacements ne doivent jamais être actifs en même temps que leurs
  versions historiques.
- `MC2 — Offre expirée — Downsell SSR` reste séparé et inchangé.
- Le SQL de transition doit être exécuté manuellement par Sonny ; il n'a pas
  été exécuté par Codex.

## Règle centrale

Le replay et l'offre ont désormais deux échéances différentes :

- **Replay :** il expire 72 heures après l'heure officielle de la session.
- **Offre vue pendant le direct :** elle expire 72 heures après l'heure
  officielle de la session.
- **Offre découverte en replay :** au premier CTA, elle reçoit une échéance
  personnelle égale à `CTA réel + (72 h - durée de vidéo avant le CTA)`.
- Avec le CTA replay actuel à `01:19:00`, le prospect découvre donc environ
  `70:41:00` de décision, jamais « 3 jours pile ».
- Une pause ou une absence avant le CTA ne consomme pas le temps commercial.
- Dès que le CTA a été atteint, l'échéance `offer_expires_at` devient immuable
  et le countdown ne se met plus jamais en pause.
- Si la vidéo change, `MC2_REPLAY_CTA_SECONDS` doit être ajusté : toute la
  chronologie personnelle s'adaptera automatiquement.

## Scénarios en langage simple

| Scénario | Ce qui se passe |
|---|---|
| CTA vu pendant le direct | L'offre conserve l'échéance globale de la session. |
| Arrivée tardive pendant le direct | Le prospect rejoint le direct au moment en cours et garde la même échéance globale. |
| Départ avant le CTA | Un email permet de reprendre la vidéo ; aucune offre personnelle n'est encore créée. |
| No-show qui regarde le replay | Son offre personnelle est créée seulement lorsqu'il atteint réellement le CTA. |
| Pause du replay avant le CTA | La pause ne réduit pas le temps accordé pour décider. |
| CTA atteint très tard dans le replay | Le prospect reçoit quand même sa fenêtre personnelle d'environ 70 h 42. |
| Retour après avoir vu le CTA | L'ancienne échéance est reprise ; elle n'est jamais réinitialisée. |
| Départ après le CTA | Le countdown et la séquence commerciale continuent pendant son absence. |
| Replay expiré sans CTA | La vidéo ferme et aucune séquence d'offre n'est créée. |
| Replay expiré après CTA | La vidéo ferme, mais l'offre déjà découverte reste accessible jusqu'à son échéance personnelle. |
| Achat | Tous les jobs restants sont annulés et les groupes déclencheurs sont retirés. |
| Offre expirée sans achat | Le downsell SSR existant est déclenché cinq minutes après l'échéance personnelle. |

## Source de vérité technique

- `offer_expires_at` est l'unique échéance commerciale immuable.
- L'échéance replay est dérivée de `session_starts_at + 72 h` ; elle ne dépend
  plus de `offer_expires_at`.
- Le premier CTA crée les jobs offre à partir de son heure réelle.
- MailerLite ne contient aucun délai : notre backend ajoute le prospect au bon
  groupe exactement au moment prévu.
- Chaque job est unique par token, session, échéance et type de message.
- Avant chaque ajout à un groupe, le backend revérifie l'achat, le segment,
  l'échéance et la pertinence du message.
- Un message devenu obsolète est ignoré ; aucune rafale de rattrapage ne part.

## Chronologie finale

| # | Audience | Moment exact | Type interne | Groupe MailerLite |
|---:|---|---:|---|---|
| 1 | No-show | Session 11 h : 14 h ; session 20 h : lendemain 9 h | `no_show_initial` | MC2 — Replay — no-show |
| 2 | Parti avant CTA | 90 min après la dernière présence réelle | `left_before_cta_initial` | MC2 — Replay — parti avant offre |
| 3 | Replay non terminé | Échéance replay - 24 h | `replay_24h` | MC2 — Replay — 24 heures restantes |
| 4 | Replay non terminé | Échéance replay - 4 h | `replay_4h` | MC2 — Replay — 4 heures restantes |
| 5 | Offre vue sans achat | Premier CTA + 90 min | `offer_followup_90m` | MC2 — Offre — suivi 90 minutes |
| 6 | Offre vue sans achat | Premier CTA + 12 h | `offer_consultations_12h` | MC2 — Offre — consultations 12 heures |
| 7 | Offre vue sans achat | Premier CTA + 36 h | `offer_proof_36h` | MC2 — Offre — preuve 36 heures |
| 8 | Offre vue sans achat | Premier CTA + 48 h | `offer_5_places` | MC2 — Offre — 5 places restantes |
| 9 | Offre vue sans achat | Échéance personnelle - 4 h | `offer_4h` | MC2 — Offre — 4 heures restantes |
| 10 | Offre vue sans achat | Échéance personnelle - 1 h | `offer_1h` | MC2 — Offre — 1 heure restante |
| — | Offre expirée sans achat | Échéance personnelle + 5 min | `offer_expired_downsell` | MC2 — Offre vue — sans achat |

Les rappels replay s'arrêtent dès que le CTA est vu. La séquence offre prend
alors le relais depuis le premier CTA réel, en direct ou en replay.

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
reste disponible jusqu'à l'échéance affichée sur ta page.

**CTA : JE REGARDE LA MASTERCLASS**

Lien : `{$mc2_replay_url}`

Si tu vas jusqu'à l'offre, le temps accordé pour décider commencera seulement
lorsqu'elle te sera présentée.

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

**Préheader :** Après, ton accès au replay disparaît.

Bonjour {$name},

Dans 4 heures, ton accès au replay disparaîtra.

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

Tu as un an pour aller au bout de la formation. Et si, une fois au bout, tu
n'as pas manifesté ce que tu veux, la Garantie Manifestation te rembourse
intégralement. Une seule condition : terminer la formation.

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
méthode, l'accompagnement, les bonus et la Garantie Manifestation pendant un an.

Il ne reste qu'une question : est-ce que tu veux continuer comme avant, ou
prendre aujourd'hui la décision qui peut enfin changer la suite ?

**CTA : JE PRENDS MA DÉCISION**

Lien : `{$mc2_offer_url}`

Sonny 🦋

## État MailerLite vérifié

Les dix workflows suivants possèdent un seul déclencheur « rejoint le groupe »,
un seul email immédiat et aucun délai interne. Ils sont tous inactifs.

| Workflow préparé | ID workflow | ID email |
|---|---:|---:|
| MC2 — Offre — Suivi 90 minutes | `197533272531535502` | `197533525445969046` |
| MC2 — Offre — Consultations 12 heures | `197534166720447818` | `197534167024535046` |
| MC2 — Offre — Preuve 36 heures | `197534185955525715` | `197534186438919359` |
| MC2 — Replay — 24 heures restantes | `197534191078868144` | `197534191983789427` |
| MC2 — Replay — 4 heures restantes | `197534196224231154` | `197534196337477380` |
| REMPLACEMENT — MC2 — Replay — No-show | `197534198446162949` | `197534199542973664` |
| REMPLACEMENT — MC2 — Replay — Parti avant CTA | `197534200641881500` | `197534201053971940` |
| REMPLACEMENT — MC2 — Offre — 5 places restantes | `197534202855425571` | `197534203335673417` |
| REMPLACEMENT — MC2 — Offre — 4 heures restantes | `197534204986132253` | `197534206585210598` |
| REMPLACEMENT — MC2 — Offre — 1 heure restante | `197534207164024247` | `197534207502714673` |

### Corrections appliquées le 3 septembre

- Email no-show : suppression de la fausse affirmation selon laquelle le replay
  et l'offre expirent ensemble.
- Email replay H-4 : le préheader et le corps parlent désormais uniquement de
  l'expiration du replay.
- Les deux emails corrigés ont été relus directement dans l'éditeur MailerLite ;
  leurs CTA pointent toujours vers `{$mc2_replay_url}`.
- Les huit autres corps et leurs liens ont été audités sans modification.

### Workflows historiques à remplacer au basculement

| Workflow historique actif | ID historique | Remplacement inactif |
|---|---:|---:|
| MC2 — Replay — No-show | `195693524899857672` | `197534198446162949` |
| MC2 — Replay — Parti avant CTA | `195693799687587517` | `197534200641881500` |
| MC2 - 5 places restantes | `196804801045989309` | `197534202855425571` |
| MC2 - 4 heures restantes | `196773823356340182` | `197534204986132253` |
| MC2 - 1 heure restante | `196774788275898273` | `197534207164024247` |

Le downsell `MC2 — Offre expirée — Downsell SSR`
(`195694015866209539`) ne doit pas être désactivé ni remplacé.

## Groupes et variables d'environnement

### Nouveaux groupes déjà créés

```text
MAILERLITE_GROUP_MC2_OFFER_FOLLOWUP_90M=197533153062028679
MAILERLITE_GROUP_MC2_OFFER_CONSULTATIONS_12H=197533206100051950
MAILERLITE_GROUP_MC2_OFFER_PROOF_36H=197533216282773033
MAILERLITE_GROUP_MC2_REPLAY_24H=197533224933524566
MAILERLITE_GROUP_MC2_REPLAY_4H=197533234002658403
```

### Groupes historiques à réutiliser

```text
MAILERLITE_GROUP_MC2_REPLAY_NO_SHOW=195693118191830886
MAILERLITE_GROUP_MC2_REPLAY_BEFORE_CTA=195693118582948971
MAILERLITE_GROUP_MC2_OFFER_5_PLACES=196865277497968364
MAILERLITE_GROUP_MC2_OFFER_4H=196865277172909150
MAILERLITE_GROUP_MC2_OFFER_1H=196865277333341742
```

### Flags backend

Ils restent désactivés jusqu'à la validation finale des messages et du parcours :

```text
MC2_REPLAY_RECOVERY_ENABLED=false
MC2_OFFER_EMAILS_ENABLED=false
```

## SQL de transition

Fichier à exécuter manuellement dans Supabase avant le basculement :

`sql/mc2_personal_offer_deadline.sql`

Il efface uniquement les anciennes échéances préattribuées aux inscriptions
encore actives qui n'ont jamais vu le CTA. Il ne touche ni aux acheteurs, ni aux
offres déjà découvertes, ni aux inscriptions dont le replay est déjà expiré.

## Checklist de relecture par Sonny

Pour chaque email :

1. Lire l'objet et le préheader.
2. Lire le corps sur desktop et mobile.
3. Vérifier le ton, chaque promesse et chaque chiffre.
4. Cliquer le CTA en prévisualisation et vérifier la variable attendue.
5. Vérifier l'expéditeur `Sonny Court <info@sonnycourt.com>`.

Pour la chronologie :

1. Direct : vérifier que le CTA reprend l'échéance session + 72 h.
2. Replay : vérifier qu'un premier CTA affiche environ 70 h 42 restantes.
3. Recharger après le CTA : vérifier que l'échéance ne change pas.
4. Quitter avant CTA puis reprendre : vérifier qu'aucune durée commerciale n'a
   été consommée pendant l'absence.
5. Vérifier les rappels replay H-24 et H-4 sur l'échéance globale.
6. Vérifier les emails offre à CTA +90 min, +12 h, +36 h, +48 h, H-4 et H-1.
7. Acheter avant une échéance : vérifier l'annulation de tous les jobs restants.
8. Expirer sans achat : vérifier le downsell cinq minutes plus tard.

## Ordre de mise en ligne

1. Sonny valide les dix messages dans ce fichier.
2. Sonny exécute `sql/mc2_personal_offer_deadline.sql` dans Supabase.
3. Renseigner et vérifier tous les IDs de groupes en production.
4. Déployer le backend et les pages par `npm run deploy:production` uniquement.
5. Tester avec des contacts internes : direct, no-show, départ avant CTA, CTA
   replay tardif, achat et expiration.
6. Mettre en pause les cinq workflows historiques à remplacer.
7. Activer les dix nouveaux workflows MailerLite.
8. Activer `MC2_REPLAY_RECOVERY_ENABLED` et `MC2_OFFER_EMAILS_ENABLED`.
9. Vérifier qu'aucun prospect ne peut recevoir les deux versions d'un email.
