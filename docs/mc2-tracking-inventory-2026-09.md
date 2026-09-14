# MC2 — inventaire et définitions (14 septembre 2026)

## Présent avant cette intervention

- Confirmation : visite, ouverture workbook, calendrier téléchargé, clic pour rejoindre.
- Session : page consultée, entrée en session, présence périodique (60 s), position vidéo maximale, paliers vidéo (1/15/30/45/60/75/90/100 minutes), incidents de lecture.
- Replay : démarrage, progression/position maximale, présence périodique, activation de l'offre.
- Offre : `cta_reached` (activation temporelle et déclenchement des automatismes existants), `invitation_visited`, sections et profondeur 25/50/75/90/100 %.
- Acquisition : Meta PageView/événements serveur, Google Analytics selon consentement, Clarity. Cette intervention ne remplace pas ces intégrations.
- Achat : confirmation serveur dans le webhook Spiffy. Un clic et l'accès à la phase 3 ne sont jamais un achat confirmé.

Limites découvertes : `cta_reached` n'est pas une preuve d'attention réelle ; un saut/repositionnement vidéo pouvait remplir des paliers non regardés ; l'ancien code de clic utilisait les plans une/trois fois ; le nouveau popup n'émettait pas ses propres étapes. La présence périodique seule ne prouve ni lecture ni visibilité.

## Événements ajoutés, Session et Replay

- `video_active_presence` : durée de lecture observée, regroupée par minute du média. Échantillonnage 1 s, émission par blocs de 10 s et à un changement de minute/onglet ou départ. Seulement onglet visible, vidéo en lecture, progression effective, sans seek ou grand saut. Aucun remplissage rétrospectif des minutes sautées.
- `offer_available_present` : offre disponible et onglet visible ; indique aussi si la vidéo progresse à ce moment-là. Un retour tardif est horodaté au retour, pas à l'activation d'origine.
- `offer_actually_seen` : une portion significative du bloc offre est dans le viewport visible, sans popup par-dessus. Ne signifie pas que toute l'offre est lue.
- `checkout_clicked` (+ événements historiques CTA et checkout viewed) : popup effectivement ouvert, quel que soit le bouton déclencheur. Un clic désactivé ne compte pas.
- `checkout_step_viewed`, metadata.step 1/2/3 : 1 identité, 2 choix du plan après identité valide, 3 zone paiement après validation du plan. Les retours et réouvertures peuvent produire plusieurs vues ; compter les personnes uniques pour le funnel.
- `checkout_plan_selected` : plan six/twelve et mode de paiement correspondant, pas une/trois fois.
- `checkout_payment_ready` : iframe prête et visible sur la phase 3. Distinct du simple accès à la phase 3, ne signifie pas carte renseignée.
- `checkout_closed` : fermeture du popup et dernière étape ; pas une conclusion d'abandon définitif.
- Sections existantes : recontrôlées lorsque visibles, pas en onglet masqué ou derrière le popup ; les cinq bonus sont distingués.

## Exploitation

Source : table existante `mc2_funnel_events` ; aucune migration SQL. Filtrer `page_path` pour séparer `/mc2/session/` et `/mc2/replay/`.

Funnel : personnes distinctes par token pour offre disponible, offre visible, ouverture checkout, étapes 1/2/3, paiement prêt, achat confirmé serveur. Pour l'étape atteinte : maximum de metadata.step, sans conclure qu'un paiement a réussi.

Rétention : utiliser exclusivement `video_active_presence`, pas les anciens `video_checkpoint`, pour les secondes réellement observées. Grouper par token/route/minute/visit_id ; sommer active_seconds au sein d'une visite, puis plafonner à 60 secondes par minute. Pour éviter de sommer deux onglets simultanés, prendre le maximum des visites par token/route/minute (conservateur si une personne recharge). Présence par minute : au moins un échantillon ; vue significative : seuil explicite, par exemple 10 secondes. Les graphiques historiques ne sont pas automatiquement réécrits par ces nouveaux événements.

## Fiabilité et limites

Les nouveaux événements utilisent un identifiant stable pour leurs retransmissions, jusqu'à trois reprises réseau et déduplication serveur ; mode preview sans écritures réelles. Ni email, prénom ni données bancaires dans les métadonnées. Le token de rattachement est celui déjà employé par MC2.

Les automatismes historiques d'expiration/SMS liés à `cta_reached` restent inchangés : ne pas interpréter ce compteur historique comme une impression réelle. Les nouveaux signaux permettent la mesure exacte selon les définitions ci-dessus, pas une preuve que la personne regarde physiquement l'écran. Bloqueurs, fermeture forcée du navigateur, réseau durablement coupé, arrondi à la frontière d'une minute et onglets multiples empêchent une garantie zéro perte/zéro faux positif. Aucune saisie dans l'iframe Spiffy n'est espionnée ; les étapes internes carte/CGV/3DS ne sont pas déduites de l'ouverture du popup.
