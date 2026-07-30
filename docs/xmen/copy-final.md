# Copy FINAL — /invitation-xmen — refonte Dean (version définitive, post-audits)

Ordre FINAL de la page. Chaque section : statut (RÉUTILISER / RÉÉCRIRE / NOUVELLE) + copy française complète, prête à implémenter telle quelle.
Règles appliquées : aucun total 12× nulle part (ni 2 364, ni 1 764) · prix à ~75 % (section 12/17) · ancres hautes avant tout prix · garantie « fais le travail » harmonisée partout + auto-question à chaque bloc prix · témoignages réels uniquement, un par affirmation · countdown + compteur de places conservés intacts (IDs protégés) · l'expression « sans condition » est BANNIE de toute la page · maximum 4 mentions de la deadline (S3, S13, S17, Q8).

---

## PRÉ-REQUIS DE MISE EN LIGNE (BLOQUANTS — interdiction de shipper tant que non faits)

1. **Checkouts Envol et Chrysalide.** Créer les 2 checkouts Spiffy (12×147 / comptant 1 497 ; 247 comptant / 3×97). Les CTA des paliers 2 et 3 pointent vers `/invitation-es2/?palier=envol` et `/invitation-es2/?palier=chrysalide` : la page `/invitation-es2` doit lire le paramètre `palier` et rediriger vers le bon checkout Spiffy (défaut sans paramètre = checkout Métamorphose Complète actuel). Ce choix conserve le préfixe `/invitation-es2` sur TOUS les CTA, donc le sélecteur existant `a[href*="/invitation-es2"]` (structure-map L86–90) continue de propager le token (`&t=` est ajouté si `?` déjà présent — comportement vérifié) et le tracking `cta_clicked`/`checkout_clicked`.
2. **Date J+42 dynamique (section 17).** Le `<span id="future-date-j42">` doit être rempli par JS : `offerExpiryMs + 42 × 86 400 000`, formaté en français (« lundi 31 août »). Fallback si `offerExpiryMs` absent : le JS remplace le H2 entier par « Dans 6 semaines, deux versions de toi existent déjà ». Aucune date absolue statique nulle part.
3. **Répartition des paliers** : conforme à la spécification d'offre validée (Métamorphose Complète = tout ; Envol = programme complet 5 étapes + communauté + bonus avancés, sans Romain/feedback Sonny/Morpho ; Chrysalide = cœur de méthode Modules 1–3 + communauté). C'est la source de vérité — aucune autre répartition.
4. **Libellé carte places** (top L143–167 + miroirs L433–457 et L1046–1070) : le texte du label devient « Places Métamorphose Complète — accompagnement humain ». IDs et classes (`#current-places`, `.scarcity-number`, `.es2-mirror-places`, etc.) inchangés au caractère près.
5. **Bloc vidéos (section 14)** : supprimer la carte `data-video="1"` (review Malika — doublon avec sa story section 7). Conserver John (`data-video="2"`) et Emilie (`data-video="3"`) avec leurs classes intactes. Le bloc vidéos passe APRÈS le texte de garantie.
6. **Mini-cards Greg et Peter : supprimées de la page** (citations réelles mais contre-productives — majuscules/anglicisme sans fait pour Greg, registre hype + « je ne suis pas payé » pour Peter). Ne pas les réutiliser ailleurs sans nouvelle citation sourcée.

Choix documentés (en connaissance de cause) : Pascaline et Beven restent sans chiffre précis — aucun chiffre ne sera inventé. Aucune menace de hausse de prix ni avantage « charter member » : aucun fait vrai ne le permet aujourd'hui. Les totaux comptants (1 997 €, 1 497 €, 247 €) restent imprimés — conforme à la règle ES2 (seuls les totaux 12× sont bannis).

---

## SECTION 1 — Bannières + config promo — RÉUTILISER lignes 88–103 tel quel

Aucun changement. `#promo-config` et bannières intacts.

---

## SECTION 2 — Hero — RÉÉCRIRE (remplace lignes 104–129)

Visuel : cover papillon ES20-banner.webp conservée, même cadre premium.

**Kicker (au-dessus du H1) :**
Invitation personnelle — réservée aux participants de la masterclass.

*(Aucune mention d'expiration ici : la deadline attend la section 3, où vit le countdown.)*

**H1 (promesse système en 3 temps, split sur 3 lignes comme l'actuel) :**
Trouve le programme qui te bloque.
Remplace-le.
Regarde tes automatismes changer de camp.

**Sous-titre :**
Esprit Subconscient 2.0 — la méthode complète pour reprogrammer ton subconscient en 5 étapes. 15 minutes par jour. Premiers signes en moins de 2 semaines.

**Ligne boucle ouverte (sous la cover) :**
Sur cette page, je vais te montrer pourquoi rien de ce que tu as essayé jusqu'ici ne pouvait tenir — et pourquoi ce n'était pas ta faute. Lis jusqu'au bout : la partie sur ton thermostat intérieur va probablement changer ta façon de voir tes dix dernières années.

*(Pas de CTA dans le hero. Pas de prix. La boucle « thermostat intérieur » est refermée nommément en section 5.)*

---

## SECTION 3 — Deadline + places (scarcity top) — RÉUTILISER lignes 131–167 (libellé places modifié, cf. pré-requis 4) ; SUPPRIMER lignes 169–184

- Countdown `#offer-days/hours/minutes/seconds` + carte places `#scarcity-card` / `#current-places` : **structure, IDs et classes intacts au pixel près.** Seul le texte du label devient « Places Métamorphose Complète — accompagnement humain ».
- **Supprimer** le bloc `.scarcity-payment-block` (mini carte « 12 mensualités 197€ » + CTA) : aucun prix ne doit apparaître avant la section 12.
- Seul ajout, une ligne sous la carte places :

**Micro-ligne :**
Prends le temps de lire. Cette page répond à tes questions une par une — et ton accès reste ouvert jusqu'à dimanche 23h. *(Mention deadline 1/4.)*

---

## SECTION 4 — Histoire d'identification — NOUVELLE

**Kicker :** Une histoire vraie

**H2 :** Il est 23h07, et tu recommences à y croire

Tu connais ce moment. La maison est silencieuse, le téléphone éclaire ton visage, et tu regardes une vidéo de plus sur le développement personnel. Tu prends des notes que tu ne reliras jamais. Tu te dis que cette fois, c'est la bonne. Que lundi, tout change.

Et lundi arrive. Et mercredi, la vieille vie a déjà repris sa place, comme si rien ne s'était passé.

Sasha connaissait ce moment par cœur.

Des années à consommer du contenu. Des livres soulignés, des podcasts, des routines matinales commencées douze fois. Elle faisait tout « bien ». Et rien ne bougeait vraiment. Alors une question a commencé à s'installer, celle qu'on n'ose dire à personne :

**« Et si le problème, c'était moi ? »**

Retiens cette question. Parce que la réponse — la vraie, celle que personne ne lui avait jamais donnée — est la raison d'être de cette page. Et quand Sasha l'a comprise, quatre jours plus tard, elle savait exactement quoi faire. Je te montre ça dans une minute.

---

## SECTION 5 — « Ce n'était pas ta faute » — le subconscient — NOUVELLE

**H2 :** Pourquoi tout retombe toujours — et pourquoi ce n'était pas ta faute

Ton cerveau fait tourner deux systèmes en permanence. Regarde la mécanique.

Le premier, c'est ta conscience. Celle qui lit cette page, qui prend des décisions, qui se motive, qui fait des plans. C'est elle que tu entraînes depuis des années avec les livres, les vidéos, les affirmations.

Le second, c'est ton subconscient. Il gère l'essentiel de tes réactions, tes automatismes, tes émotions, tes choix « instinctifs » — la machine qui décide avant que tu aies l'impression de décider. Et il tourne sur des programmes installés pour beaucoup dans l'enfance — bien avant que tu aies voix au chapitre. Des programmes que tu n'as jamais choisis.

Voilà pourquoi tout ce que tu as essayé a échoué : **tu envoyais ta volonté se battre contre un programme.**

C'est comme un thermostat. **Ton thermostat intérieur** — celui dont je te parlais en haut de page. Tu peux ouvrir les fenêtres en grand un jour de motivation — la température monte une heure. Puis le thermostat fait son travail : il ramène tout à la valeur programmée. Ta vie amoureuse, ton rapport à l'argent, ta confiance : chacun a son réglage d'usine. Tant que le réglage ne change pas, la pièce revient toujours à la même température.

Relis maintenant tes dix dernières années avec cette grille. Les élans retombés. Les décisions jamais tenues. Les schémas qui se répètent avec des visages différents. Ce n'était pas un manque de volonté. Ce n'était pas un défaut de caractère. Tu jouais contre un adversaire que tu ne pouvais pas voir.

**Ce n'était pas ta faute.** Mais maintenant tu vois le réglage. Et la seule question qui compte a changé : ce n'est plus « pourquoi rien ne tient ? » — c'est « qu'est-ce que je fais du thermostat ? »

C'est exactement ce que Sasha a compris.

> **Sasha — Déclic en 4 jours** *(story card existante, avatar Sasha.webp, tag reformulé)*
> « Après seulement 4 jours, cette formation m'a redonné un énorme coup de boost pour la poursuite de mes rêves. Je me suis reconnue dans les schémas et je sais maintenant exactement ce que je dois faire pour y arriver. »

Ce qui a changé pour Sasha en quatre jours, ce n'est pas qu'elle a appris des techniques magiques. C'est qu'elle s'est vue dans le miroir pour la première fois. Le problème n'a jamais été elle. C'était le programme. Et un programme, ça se réécrit.

---

## SECTION 6 — Autorité Sonny — NOUVELLE

**Kicker :** Qui je suis pour te dire ça

**H2 :** J'ai passé neuf ans sur une seule question

Je m'appelle Sonny Court. Depuis 2017, je ne travaille que sur une chose : comment reprogrammer concrètement un subconscient — pas en théorie, pas en citations inspirantes, mais avec un protocole qu'une personne normale peut suivre chez elle.

J'ai commencé par moi. J'étais le cas d'école : des années d'efforts sincères, des résultats en dents de scie, et ce plafond invisible que je finissais toujours par toucher. J'ai exploré l'hypnose, les neurosciences, les travaux sur la plasticité cérébrale, et des pratiques anciennes — je n'ai gardé que ce qui survivait au test : reproductible sur moi, puis sur d'autres. J'ai jeté 90 % de ce que j'ai appris.

Ce qui restait, je l'ai structuré en une méthode. Des milliers de francophones l'ont suivie. Tu viens d'en voir les fondations dans la masterclass — c'est d'ailleurs pour ça que tu es sur cette page : elle n'est accessible qu'aux participants.

Ce que la masterclass t'a donné, c'est le diagnostic. Ce qu'elle ne pouvait pas te donner en deux heures, c'est la reprogrammation elle-même. Elle demande un protocole précis, dans un ordre précis, sur plusieurs semaines.

Ce protocole a un nom.

---

## SECTION 7 — La Méthode Morpho : ta métamorphose en 5 étapes — RÉÉCRIRE (enrichit lignes 189–251, visuels et cartes conservés)

**Kicker :** La technologie de la transformation

**H2 :** Ta métamorphose en 5 étapes

**Intro (nouvelle) :**
Le papillon Morpho ne « s'améliore » pas. Il ne devient pas une meilleure chenille. Il change de nature. C'est le modèle exact de la méthode : cinq étapes, dans cet ordre, jamais autrement. Chaque étape a son protocole — tu sauras toujours quoi faire, quel jour, et pourquoi.

**01 — L'aube avant la lumière** · *Le protocole : la Cartographie*
« Tu dormais sans le savoir, enveloppé d'une inconscience si familière que tu la prenais pour la vie. Puis cette masterclass a posé des mots sur ce qui te bloquait depuis toujours. La coquille s'est fissurée de l'intérieur. » *(texte existant conservé)*
**Ajout :** Concrètement : tu cartographies les 3 à 5 programmes racines qui pilotent ta vie — ceux que tu n'as jamais vus parce que tu vis dedans.

**02 — Entre deux mondes** · *Le protocole : le Point de bascule*
« Tu n'es plus qui tu étais. Pas encore qui tu veux devenir. C'est l'instant clef de ta transformation. Celui où le savoir seul ne protège de rien. Sans matière pour te nourrir, sans action pour avancer, sans structure pour te protéger, sans cela, le papillon meurt avant d'avoir existé. » *(existant conservé)*
**Ajout :** Concrètement : tu installes la structure quotidienne de 15 minutes qui empêche ce que tu as compris de s'évaporer — le destin de presque toutes les prises de conscience laissées sans structure.

**03 — Disparaître pour renaître** · *Le protocole : la Dissolution dirigée*
« Dans le cocon, la chenille se dissout entièrement. Elle cesse d'être pour devenir autre chose. C'est la loi de toute vraie transformation. On ne devient pas ce qu'on veut en ajoutant. On le devient en laissant mourir ce qu'on était. À l'extérieur, rien ne se voit. À l'intérieur, tout change. » *(existant conservé)*
**Ajout :** Concrètement : autohypnose et exercices guidés pour désactiver les anciens programmes un par un — pas les recouvrir de pensée positive, les désactiver.

> **Pascaline, 42 ans** *(mini-card existante, avatar Pascaline.webp — sans chiffre, assumé)*
> « Une vraie révélation. Les exercices m'ont permis de voir mes blocages autrement et de redéfinir mes priorités. »

**04 — Les premiers signes** · *Le protocole : les Confirmations*
« Le papillon ne vole pas encore. Mais il sait déjà que le ciel est à lui. Les premières synchronicités arrivent. Une rencontre inattendue. Une porte qui s'ouvre. Une coïncidence trop parfaite pour en être une. Ce ne sont pas des preuves... Tu n'en as plus besoin. Ce sont des confirmations. » *(existant conservé — registre poétique assumé de la carte, seule occurrence de ce champ lexical)*

**C'est exactement ce qui est arrivé à Malika.**

> **Malika — Résultat en 30 jours** *(story card existante complète, avatar Malika.webp)*
> Malika avait peur. Cette peur familière qui paralyse des millions de gens chaque jour. Elle voulait quitter son travail pour lancer son entreprise. Elle savait au fond d'elle que c'était la bonne décision.
> Mais à chaque fois qu'elle s'apprêtait à passer le cap, son subconscient tirait sur le frein à main. « Et si je me trompe ? Et si je perds tout ? Qui suis-je pour oser ? »
> Un jour, elle a décidé d'arrêter de tourner en rond et de faire le vrai travail. Le travail intérieur. En profondeur.
> En un mois, elle a démissionné. Trois semaines plus tard, une pépinière d'entreprises l'a contactée pour participer à un concours d'accélérateur. Sur des centaines de candidats, ils n'allaient en sélectionner que 15. Elle a été sélectionnée. Quelques semaines après, elle a postulé pour une formation universitaire qu'elle convoitait depuis des années. Acceptée aussi.
> « C'est comme si toutes les portes s'ouvraient à moi. Comme si à chaque obstacle que je rencontrais, une solution se dressait. Et à chacune de mes volontés, les réalisations arrivaient. »

Ce n'est pas de la chance. Ce n'est pas le hasard. C'est un subconscient qui a changé de camp.

**05 — Ta vraie nature révélée** · *Le protocole : l'Identité intégrée*
« Le papillon ne se souvient plus d'avoir été chenille. Il vole... C'est tout ce qu'il connaît. Tu n'essaies plus de changer ta vie. Tu la vis. Tes désirs ne sont plus des rêves, ils sont ta réalité quotidienne. Et au fond de toi, une vérité silencieuse : tu n'es pas devenu quelqu'un d'autre. Tu es enfin qui tu étais depuis toujours. » *(existant conservé)*

---

## SECTION 8 — « Tu as trois options » — NOUVELLE (les ancres hautes — aucun prix ES2 ici)

**H2 :** À partir d'ici, tu as trois options

**Option 1 — Continuer seul.**
Les livres, les vidéos, la volonté. C'est gratuit. Tu sais déjà ce que ça donne : tu viens de relire tes dix dernières années deux sections plus haut. Le vrai prix de cette option, c'est un an de plus à la même température.

**Option 2 — Te faire accompagner en individuel.**
C'est la voie sérieuse — et je la respecte. Une thérapie ou un accompagnement hypno en cabinet, c'est 150 à 200 € la séance. Au rythme d'une séance par semaine, l'année dépasse les 7 000 €, et tu dépends du rythme d'un agenda qui n'est pas le tien.
Il y a aussi le coaching privé avec moi. L'an dernier, j'ai accepté deux clients en accompagnement individuel, à 4 500 € chacun. J'ai fermé la liste depuis, et je ne compte pas la rouvrir : ce format ne me permet d'aider que deux personnes par an.

**Option 3 — Suivre le système complet, chez toi.**
Le même travail en profondeur que l'option 2 — la structure, les protocoles, l'accompagnement — mais porté par une méthode conçue pour être suivie en autonomie, 15 minutes par jour, avec de vrais humains aux points critiques du parcours. C'est ce que je te présente dans un instant.

Mais d'abord, une question honnête : est-ce que c'est pour toi ?

---

## SECTION 9 — « Est-ce pour toi ? » — NOUVELLE

**H2 :** Esprit Subconscient 2.0 n'est pas pour tout le monde

**ES2 est fait pour toi si :**
- Tu as déjà « tout essayé » en surface, et tu sens que le vrai travail est plus profond
- Tu peux tenir 15 minutes par jour — pas des heures, 15 minutes
- Tu veux un chemin structuré, jour par jour, pas une bibliothèque de vidéos en vrac
- Tu es prêt à ce que certaines prises de conscience soient inconfortables avant d'être libératrices

**ES2 n'est pas pour toi si :**
- Tu cherches un résultat sans rien changer à l'intérieur
- Tu veux « regarder la formation » comme on regarde une série — le contenu ne reprogramme rien, la pratique oui
- Tu comptes décider dans trois mois : cette page est liée à ta session de masterclass, pas à un catalogue permanent

**Et si tu te dis que c'est trop tard pour toi — trop d'années, trop d'échecs, trop d'usure — lis ce qui suit attentivement.**

> **Thierry — Résultat en 3 semaines** *(story card existante, avatar initiales)*
> Thierry avait 60 ans quand il a commencé. Une fibromyalgie. Un cancer de la prostate. Une retraite anticipée pour invalidité après dix années de combat. Sa pension était modeste. Son moral fluctuait au jour le jour. Et au fond de lui, une petite voix lui répétait que sa vie, c'était ça maintenant. Qu'il était trop tard. Qu'il avait raté son tour.
> « En à peine trois semaines, j'ai retrouvé ma joie de vivre et la capacité à gérer le stress et les soucis quotidiens sans être envahi par des pensées négatives. La formation a été une révélation. »

Trois semaines. À 60 ans. Après une décennie de combat contre la maladie. Si Thierry a pu le faire dans ces conditions-là, « trop tard » n'est pas un fait. C'est une croyance. Et ça tombe bien : c'est exactement la matière qu'on travaille.

---

## SECTION 10 — Révélation du programme : « Donne-moi 6 semaines » — RÉÉCRIRE (fusionne lignes 253–368 + modules 862–954 ; carte « valeur totale 3 988 € » lignes 409–425 SUPPRIMÉE)

**H2 (split existant conservé) :** Ce que tu vas obtenir avec **Esprit Subconscient 2.0**

**Nouveau chapô (remplace « La transformation complète sur 6 mois ») :**
**Donne-moi 6 semaines.** 15 minutes par jour. Voici, semaine par semaine, ce qui se passe :

**Timeline 6 semaines (nouveau bloc) :**
- **Semaines 1–2 — La Cartographie + le Point de bascule.** Tu identifies tes programmes racines et tu installes la structure quotidienne. C'est là qu'arrivent les premiers signes : sommeil, calme mental, une rumination qui lâche. Moins de deux semaines pour la plupart.
- **Semaines 3–4 — La Dissolution dirigée.** Autohypnose quotidienne. Les anciens réflexes commencent à rater leur déclenchement — tu te surprends à réagir autrement, sans effort.
- **Semaines 5–6 — Les Confirmations.** Ton entourage remarque quelque chose sans savoir quoi. Toi, tu vois tes réactions changer en situation réelle — et tu sais exactement pourquoi.

Et après ces 6 semaines, le programme continue de travailler avec toi sur 6 mois complets — jusqu'à l'Identité intégrée.

> **Daniel — Résultat en 2 semaines** *(story card existante, avatar initiales)*
> Daniel avait essayé. Tellement essayé. Trop d'années à tenter, trop d'années à échouer. Une partie de lui avait fini par accepter que la vie dont il rêvait n'était peut-être pas pour lui.
> « Je suis inscrit depuis environ 2 semaines, et je ressens déjà un profond bien-être. Cette formation m'aide à travailler sur moi-même en profondeur, que ce soit en matière d'abondance, d'amour ou de confiance en soi. »

Deux semaines. C'est moins que le temps qu'il faut à la plupart des gens pour décider qu'ils ont besoin de « réfléchir un peu plus » avant de se lancer. Pendant ce temps-là, Daniel changeait déjà.

**Pill volume (existant conservé) :** 36h+ de contenus · Un système de transformation sur 6 mois

**Les 12 items « check » (lignes 283–366) : RÉUTILISER tel quel** — la liste est déjà sobre et précise (subconscient reprogrammé, croyances limitantes, états sur commande, ancrage pendant le sommeil, clarté mentale, manifestation, transformation visible, neurosciences, parcours structuré, outils à vie, accès partout, mises à jour à vie).

**Les 5 modules (contenu des lignes 877–952 : RÉUTILISER les cartes, déplacées ICI, avec l'intro « Information importante » conservée) :**
- Module 1 — La réalisation (3 jours) · Module 2 — La libération (21 jours) · Module 3 — La manifestation (3 mois) · Module 4 — L'immersion (1 mois) · Module 5 — L'accélération (1 mois)
- Textes des cartes inchangés. Intro « Les 30 premiers jours sont cadrés… » inchangée.

**Sous les modules (mini-card déplacée depuis les sales stories) :**
> **Beven — membre du programme** *(mini-card existante, avatar beven.webp — sans chiffre, assumé)*
> « C'est la meilleure formation que j'ai suivie pour me développer personnellement. »

*(Toujours aucun prix. Pas de CTA ici — la page continue de tirer vers le bas.)*

---

## SECTION 11 — L'accompagnement humain + les bonus — RÉÉCRIRE (remplace lignes 371–427)

**Kicker :** Ce que des vidéos, seules, ne feront jamais

**H2 :** Tu ne seras pas seul là-dedans

Un programme, même excellent, a une limite : il ne te connaît pas. C'est pour ça que j'ai construit quatre couches d'accompagnement et d'outils autour d'ES2. Je te préviens : les trois premières sont réservées au palier le plus complet — tu comprendras pourquoi dans une minute.

**1. Trois bilans individuels avec Romain, hypnothérapeute certifié méthode Sonny Court** *(réservé au palier Métamorphose Complète)*
Un bilan par mois pendant tes 3 premiers mois. Romain fait ce travail en cabinet à 120 € la séance ; ici, il connaît ta méthode de l'intérieur, il voit ta progression sur la plateforme, et il ajuste ton protocole à TA situation. C'est la différence entre suivre une méthode et être suivi dans une méthode.

**2. Ta consultation privée avec moi au jour 30** *(réservé au palier Métamorphose Complète)*
Au bout de 30 jours, je t'envoie un formulaire personnel sur ton avancée, tes blocages et tes premières transformations. En retour, je t'écris personnellement un feedback complet avec des recommandations adaptées à TA situation. Pas un email automatisé. Un vrai échange entre toi et moi. C'est le seul format dans lequel je travaille encore en direct — depuis que j'ai fermé le coaching privé.

**3. Morpho — ton compagnon IA de transformation** *(réservé au palier Métamorphose Complète)*
12 mois d'accès à l'application web réservée exclusivement aux membres. Ton journal quotidien, ton coach IA disponible 24/7 qui connaît TA méthode, TON journal, TA progression. Je n'ai trouvé aucun équivalent en francophonie — va vérifier : morpho.day.

**4. La communauté Volt — accès à vie** *(inclus pour tout le monde)*
Rejoins pour toujours des centaines de personnes qui font exactement le même travail que toi. Pas 6 mois. Pas 1 an. À vie. Partages quotidiens, victoires collectives, soutien permanent dans chaque étape de ta vie, pas juste pendant la formation.

*(La mini-card Peter est SUPPRIMÉE — cf. pré-requis 6 : elle ne prouve pas l'affirmation de la section et son registre dessert la page. La section se termine sur la couche 4, sans témoignage.)*

*(La carte « Valeur totale 3 988 € barrée / Offre spéciale 197 €/mois » est SUPPRIMÉE : pas d'empilement de fausse valeur, et toujours aucun prix avant la section suivante.)*

---

## SECTION 12 — Les 3 paliers — RÉÉCRIRE (remplace lignes 429–497) — LE PRIX APPARAÎT ICI (~75 % de la page)

**Bloc scarcity miroir (lignes 432–458) : RÉUTILISER tel quel** (carte places `.es2-mirror-places`, sync automatique, libellé « Places Métamorphose Complète — accompagnement humain » cf. pré-requis 4).

**H2 :** Il ne reste qu'une question : lequel des trois es-tu ?

**Sous-titre :** Trois paliers. La même méthode au cœur. Choisis le niveau d'accompagnement — et souviens-toi que tu pourras toujours monter plus tard en payant simplement la différence (voir FAQ).

---

### PALIER 1 — MÉTAMORPHOSE COMPLÈTE *(présenté EN PREMIER, carte featured, badge « Le plus complet »)*

Tout. Le programme, les humains, l'application.

- La méthode complète en 5 étapes — les 5 modules, 36h+, parcours 6 mois
- **3 bilans individuels avec Romain, hypnothérapeute certifié** (1/mois pendant 3 mois — sa séance en cabinet : 120 €)
- **Ta consultation privée avec Sonny au jour 30** — feedback personnel écrit sur TA situation
- **Morpho, ton compagnon IA** — 12 mois d'accès exclusif
- La communauté Volt à vie
- Tous les bonus avancés (Modules 4 et 5 : Immersion + Accélération IA) et les mises à jour à vie

**Prix : 12 × 197 €/mois** — ça fait 6,50 € par jour.
**Ou en une fois : 1 997 € — tu économises 367 €.**

**CTA (bouton) :** Choisir Métamorphose Complète
*(href="/invitation-es2/" — image moyens de paiement conservée)*
**Micro-ligne sous le CTA :** Total et échéancier affichés avant paiement — aucun frais caché.

✓ **Garantie 30 jours :** fais les 30 premiers jours du protocole, et si ta vie ne bouge pas, remboursé intégralement. **Pourquoi si généreuse ?** Parce que je sais ce qui se passe quand tu fais le travail. Le risque est pour moi, pas pour toi. Détail complet plus bas — zéro piège.

---

### PALIER 2 — ENVOL

**Ce que tu n'auras PAS :**
- ✕ Les 3 bilans individuels avec Romain
- ✕ La consultation privée avec Sonny au jour 30
- ✕ L'application Morpho

Personne ne regardera ta situation en particulier. Tu avances avec la méthode, en autonomie.

**Ce que tu auras :**
- La méthode complète en 5 étapes — les 5 modules, 36h+, parcours 6 mois
- La communauté Volt à vie
- Les bonus avancés (Modules 4 et 5) et les mises à jour à vie

**Prix : 12 × 147 €/mois** — ça fait 4,83 € par jour.
**Ou en une fois : 1 497 € — tu économises 267 €.**

**CTA (bouton) :** Choisir Envol
*(href="/invitation-es2/?palier=envol" — cf. pré-requis 1)*
**Micro-ligne sous le CTA :** Total et échéancier affichés avant paiement — aucun frais caché.

✓ **Garantie 30 jours :** la même — fais les 30 premiers jours, et si ta vie ne bouge pas, remboursé intégralement. **Pourquoi la même garantie ?** Même confiance, même méthode.

---

### PALIER 3 — CHRYSALIDE

**Ce que tu n'auras PAS :**
- ✕ Les 3 bilans individuels avec Romain
- ✕ La consultation privée avec Sonny au jour 30
- ✕ L'application Morpho
- ✕ Les bonus avancés (Modules 4 — Immersion et 5 — Accélération IA)
- ✕ Les mises à jour à vie

**Ce que tu auras :**
- Le cœur de la méthode en 5 étapes — Modules 1 à 3 : la Réalisation, la Libération, la Manifestation
- La communauté Volt

**Prix : 247 € en une fois** (ou 3 × 97 €).

**CTA (bouton) :** Choisir Chrysalide
*(href="/invitation-es2/?palier=chrysalide" — cf. pré-requis 1)*

✓ **Garantie 30 jours, ici aussi :** fais les 30 premiers jours, et si ta vie ne bouge pas, remboursé intégralement. **Pourquoi une garantie identique au prix le plus bas ?** Parce que c'est la même méthode qui agit. Et si tu hésites avec un palier au-dessus : tu peux commencer ici et monter plus tard en payant la différence. Rien n'est jamais perdu.

---

**Ligne sous les 3 cartes :**
Si tu hésites entre deux paliers, pose-toi une seule question : est-ce que tu veux qu'un humain regarde TA situation ? Si oui, il n'y a qu'un palier qui le permet. Le compteur de places ne compte d'ailleurs que lui — les places Métamorphose Complète, les seules qui consomment du temps humain. Les deux autres paliers n'ont pas de quota : ils ferment simplement en même temps que la page.

---

## SECTION 13 — Urgence honnête, désamorcée — NOUVELLE (juste sous les paliers)

**H2 :** Parlons franchement du compte à rebours

Tu as vu le compteur en haut de la page. Tu as probablement pensé « tactique marketing ». C'est sain — tu as raison de te méfier, le web est rempli de fausses urgences.

Alors regarde le mécanisme. C'est une deadline de vente, oui. La différence : elle est câblée, pas théâtrale. Ton lien a été généré à ton inscription à la masterclass, et il se désactive dimanche à 23h — automatiquement, que je le veuille ou non. *(Mention deadline 2/4.)* Après ça, les conditions réservées aux participants disparaissent avec lui : les bilans avec Romain et ma consultation du jour 30 ne sont tout simplement pas disponibles ailleurs.

Le compteur de places, lui, ne mesure qu'une chose : les places Métamorphose Complète. Les bilans de Romain et mes feedbacks du jour 30 sont du temps humain — je ne peux en absorber qu'un nombre limité par session. Les deux autres paliers n'ont pas de quota.

Pas de pression. Une deadline câblée, des raisons claires. La décision t'appartient.

---

## SECTION 14 — Garantie 30 jours + témoignages vidéo — RÉÉCRIRE le texte garantie (lignes 757–860) ; bloc vidéos (lignes 702–756) DÉPLACÉ APRÈS la garantie, carte Malika supprimée (pré-requis 5)

**H2 :** Fais le travail pendant 30 jours. Si ta vie ne bouge pas, je te rembourse tout.

Voici le deal, en toutes lettres :

Tu rejoins ES2. Tu suis les Modules 1 et 2 et la première leçon du Module 3 — c'est le protocole minimal pour que la méthode ait eu une chance réelle d'agir, et c'est la seule chose que je te demande. Si après ça tu n'es pas satisfait, un email à support@sonnycourt.com avant la fin de tes 30 jours, et tu es remboursé intégralement sous 48h ouvrables, sur ton moyen de paiement d'origine. Sans forcing, sans culpabilisation.

**Pourquoi une garantie aussi large ?** Pose-toi la question — c'est la bonne question. La réponse : parce que je vérifie moi-même la progression sur la plateforme, et je sais ce qui se passe chez ceux qui font réellement les 30 premiers jours. Cette garantie ne me coûte presque rien en remboursements. Elle me coûterait tout si la méthode ne fonctionnait pas.

La seule chose contre laquelle je ne peux pas te garantir, c'est de ne pas commencer.

*(Les 3 steps visuels + conditions détaillées existants : conservés, reformulés dans ce ton. Cette version = exactement la même garantie que les 3 cartes prix et que la FAQ Q5 : une seule histoire de garantie sur toute la page.)*

**PUIS, en renfort (bloc vidéos existant, déplacé ici, APRÈS le texte garantie) :**
« Témoignages Vidéo — Découvre les expériences réelles de nos participants » — **John** (`data-video="2"`) et **Emilie** (`data-video="3"`), classes `.video-card`, `.custom-play-button`, `data-video` intactes. La carte Malika (`data-video="1"`) est supprimée : sa story complète vit déjà en section 7.

---

## SECTION 15 — « Pourquoi j'ai acheté » — RÉÉCRIRE depuis les sales stories (post-prix : Cyril seul, témoignage d'achat authentique)

**Kicker :** Il était exactement là où tu es

**H2 :** À ce stade de la page, Cyril hésitait aussi

> **Cyril — Résultat en 21 jours** *(story card existante, avatar Cyril.webp)*
> Cyril s'est inscrit en se disant « si ça marche pas, ça marche pas, j'aurai au moins essayé ». Il n'attendait rien de spécial. Il avait été déçu trop de fois.
> « En seulement 21 jours, j'ai pu constater de réels changements dans ma vie quotidienne et dans ma façon d'aborder les défis. C'est un investissement qui en vaut vraiment la peine. Franchement, n'hésitez pas : foncez, vous ne le regretterez pas. »
> Cyril n'avait pas de don particulier. Pas de discipline supérieure. Il n'a pas pris de raccourci. Pardon — si, un seul : celui d'arrêter de chercher des raccourcis et de travailler sur la seule chose qui compte vraiment, lui-même.

*(Greg et Beven ne racontent pas une décision d'achat : Beven est déplacé en section 10, Greg est supprimé — cf. pré-requis 6. Ici, uniquement un témoignage qui modélise l'acte d'acheter.)*

**Ligne de clôture :**
Cyril n'était pas sûr en cliquant. Il avait déjà été déçu ailleurs. La différence entre lui et ceux qui « réfléchissent encore », c'est 30 jours de garantie qu'il a décidé d'utiliser.

**CTA :** Commencer ma métamorphose *(href="/invitation-es2/")*
✓ Garantie 30 jours « fais le travail » — détail juste au-dessus

---

## SECTION 16 — FAQ — RÉUTILISER les 6 questions existantes (lignes 956–1029) tel quel + AJOUTER 2 questions

Q1–Q6 existantes : inchangées (durée, 15–20 min/jour, aucun prérequis, smartphone, remboursement détaillé, accès immédiat). **Vérifié : la Q5 existante raconte déjà exactement la même garantie que les cartes prix et la section 14 (Modules 1–2 + leçon 1 du Module 3) — une seule version de la garantie sur toute la page.**

**Q7 (nouvelle) — Je ne suis pas sûr de pouvoir prendre le palier Métamorphose Complète. Je fais quoi ?**
Commence par le palier qui respecte ton budget d'aujourd'hui — même Chrysalide. Tu pourras passer à un palier supérieur plus tard en payant simplement la différence : un email à support@sonnycourt.com et c'est réglé. Ce que tu as déjà payé est toujours déduit à 100 %. Le seul mauvais choix, c'est de ne pas commencer.

**Q8 (nouvelle) — Pourquoi l'offre expire dimanche à 23h ?** *(Mention deadline 4/4.)*
Parce que ton lien est personnel : il a été généré à ton inscription à la masterclass et il se désactive automatiquement dimanche à 23h. Les places incluant l'accompagnement humain (bilans avec Romain, consultation du jour 30) sont limitées par notre temps disponible sur chaque session. Le mécanisme complet est expliqué juste au-dessus des paliers.

---

## SECTION 17 — Close final : le coût de l'inaction — RÉÉCRIRE (remplace lignes 1031–1077, ancre `#inscription` conservée)

**Bloc countdown miroir + carte places miroir (lignes 1041–1070) : RÉUTILISER tel quel** (`.es2-mirror-days/hours/minutes/seconds`, `.es2-mirror-places`).

**H2 :** Dans 6 semaines, nous serons le <span id="future-date-j42"></span>

*(Technique — cf. pré-requis 2 : `#future-date-j42` rempli par JS = deadline du token (`offerExpiryMs`) + 42 jours, formaté en français (« lundi 31 août »). Fallback sans `offerExpiryMs` : le JS remplace le H2 entier par « Dans 6 semaines, deux versions de toi existent déjà ». Jamais de date absolue statique.)*

Deux versions de cette date existent déjà.

Dans la première, tu as fermé cette page dimanche soir. La vie a repris. Le thermostat a fait son travail. Cette date-là ressemble à aujourd'hui — mêmes pensées en boucle, mêmes freins à main, même « un jour, il faudra vraiment que je m'y mette ». Ce n'est pas un drame. C'est juste un an de plus qui commence exactement comme le précédent.

Dans la seconde, tu as donné 15 minutes par jour à la méthode. La Cartographie est faite depuis longtemps. Les premières Confirmations sont arrivées. Quelqu'un t'a dit « je ne sais pas ce qui a changé chez toi, mais ça te va bien ». Et toi, tu sais exactement ce qui a changé.

Les deux versions coûtent quelque chose. Une seule te rapproche de la vie que tu es venu chercher dans cette masterclass.

Ton accès expire dimanche à 23h. *(Mention deadline 3/4.)* Pas le travail — lui, il t'attendra toujours. Juste les conditions, et les humains qui vont avec.

**CTA final :** Commencer ma métamorphose *(href="/invitation-es2/")*
**Sous le bouton :** ✓ Garantie 30 jours « fais le travail » · Accès immédiat au Module 1 · Tu peux monter de palier à tout moment

---

## SECTION 18 — Footer + overlay expiré + toast + sticky mobile — RÉUTILISER (lignes 1079–1090, 6414–6422, 7805–7809) tel quel

Seul changement : texte du sticky mobile → **« 🦋 Commencer ma métamorphose »** (href inchangé `/invitation-es2/`).

---

## Récap conformité (Dean + audits intégrés)

- [x] Aucun total 12× imprimé (ni 2 364, ni 1 764) — mensualité / €-jour exact (6,50 · 4,83) / économie comptant ; transparence « total et échéancier affichés avant paiement » sous les CTA 12×
- [x] Ancres hautes avant tout prix : 7 000 €+ de thérapie annuelle, coaching fermé 4 500 €, Romain 120 €/séance cabinet (sections 8 et 11, prix en section 12)
- [x] « Ce n'était pas ta faute » incarné par le subconscient — sans promesse de preuve non tenue, sans formule Kern récitée
- [x] Ouverture sur une personne (Sasha, « Déclic en 4 jours »), pas sur Sonny — autorité seulement en section 6, sans ésotérisme ni vulgate Lipton ni statistique inventée
- [x] Technologie nommée : Méthode Morpho + 5 protocoles (Cartographie, Point de bascule, Dissolution dirigée, Confirmations, Identité intégrée)
- [x] 3 paliers haut→bas, won't-get AVANT le contenu sur Envol et Chrysalide, badge vérifiable « Le plus complet », chaque palier avec SON checkout
- [x] Humain rare au sommet — « quatre couches, les trois premières réservées » (arithmétique cohérente avec les listes won't-get)
- [x] Garantie UNIQUE sur toute la page : « fais les 30 premiers jours, sinon remboursé » — cartes prix, section 14, FAQ Q5, close final racontent la même histoire ; « sans condition » banni
- [x] Compteur de places = places Métamorphose Complète uniquement (libellé carte + section 12 + section 13 + Q8 alignés) ; countdown + compteur intacts (IDs protégés)
- [x] Deadline désamorcée sans nier le marketing ni auto-attester (« câblée, pas théâtrale ») ; 4 mentions au lieu de 6, aucune dans le hero
- [x] Futur simulé daté DYNAMIQUE (J+42 calculé, jamais de date en dur)
- [x] Témoignages : un par affirmation, au point de doute ; vidéos John + Emilie en renfort APRÈS la garantie ; Malika sans doublon ; Peter et Greg retirés ; Sasha « Déclic » non survendu ; Thierry sans n=1 érigé en loi ; boucle hero (« thermostat intérieur ») refermée nommément
- [x] Zéro valeur totale empilée (carte 3 988 € supprimée), zéro superlatif invérifiable (« je n'ai trouvé aucun équivalent — va vérifier »), compteurs réels conservés
- [x] Aucun fait inventé : pas de chiffres ajoutés à Pascaline/Beven, pas de fausse menace de hausse de prix, pas d'intro d'achat fabriquée
