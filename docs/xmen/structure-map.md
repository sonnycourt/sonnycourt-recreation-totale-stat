# Structure map — src/pages/invitation-xmen.astro

Fichier de 7 810 lignes. Relevé complet le 2026-07-19.
Grandes zones : frontmatter Astro L1–7 · `<head>` L10–86 · HTML body L87–1091 · CSS `<style>` L1092–6412 (pur CSS, aucun HTML/JS dedans) · toast HTML L6414–6422 · script principal L6424–7704 · script promo preview L7707–7803 · script `ready` L7804 · CTA sticky mobile L7805–7809.

---

## 1. Inventaire ordonné des sections HTML visibles

| # | Lignes | Section | Rôle | Classes CSS principales |
|---|--------|---------|------|-------------------------|
| 0 | 88–103 | Bannières + config | `<PromoBanner formation="manifest" />`, div caché `#promo-config` (data-attrs promo), `<BlackFridayBanner show={false} />` | — |
| 1 | 104–129 | **Hero** | H1 « Le seul accompagnement… » + visuel cover papillon (ES20-banner.webp) | `.hero`, `.hero-content`, `.guarantee-title.guarantee-title--split.hero-page-title`, `.guarantee-title-main`, `.guarantee-title-accent`, `.hero-cover-container`, `.premium-frame`, `.hero-cover-image` |
| 2 | 131–187 | **Scarcity (top)** | Countdown offre (`#offer-days/hours/minutes/seconds`), carte places (`#scarcity-card`, `#current-places`), mini carte paiement 12× + CTA | `.scarcity-section`, `.invitation-offer-zone`, `.offer-countdown-title/grid/box/value/label`, `.scarcity-card/kicker/phase1-total/phase2-note/main/label/value/number/denominator/unit/meter/meter__fill`, `.scarcity-payment-block`, `.payment-option--featured`, `.scarcity-payment-card`, `.cta-button-final.scarcity-payment-cta-override`, `.descriptive-guarantee` |
| 3 | 189–251 | **Features « Ta métamorphose en 5 étapes »** (papillon) | 5 cartes étape (image + texte) | `.features`, `.features-morphosis-title`, `.feature-card.fade-in`, `.feature-content`, `.feature-number`, `.feature-image` |
| 4 | 253–501 | **Descriptive (bloc unique)** « Ce que tu vas obtenir » + bonus + prix + CTA | Sous-blocs ci-dessous | `.descriptive-section`, `.descriptive-content`, `.descriptive-image-wrapper/frame/image/image-glow`, `.descriptive-text` |
| 4a | 257–260 | — heading | H2 « Ce que tu vas obtenir avec ES 2.0 » + sous-titre 6 mois | `.es2-obtain-heading`, `.es2-obtain-subtitle` |
| 4b | 273–368 | — `section.es2-obtain-section` | 12 items check bleus (36h+ de contenus) | `.es2-obtain-volume`, `.es2-volume-pill/sep/label`, `.es2-obtain-container`, `.es2-obtain-item`, `.es2-check` |
| 4c | 371–427 | — `section.es2-bonus-section` | 3 bonus (Morpho 597€, Volt 997€, consultation 497€) + carte récap prix | `.es2-bonus-kicker/title/grid/card/body/badge/name/desc/val/val-label/val-amount`, `.es2-price-summary-card`, `.es2-price-simple*` |
| 4d | 429–489 | — `.price-reveal-section` | Carte scarcity dupliquée (miroir), titre « Choisis ton plan », 3 options paiement | `.es2-scarcity-block`, `.scarcity-card` (dupliquée, `.es2-mirror-places`), `.price-arrow-down`, `.price-arrow-emoji`, `.payment-options`, `.payment-option`, `.payment-option--featured`, `.payment-option-link`, `.payment-badge`, `.payment-badge--muted`, `.payment-option-label/price/price-suffix/daily/detail/methods` |
| 4e | 491–497 | — CTA | Bouton « Commencer ma transformation » + garantie | `.descriptive-cta`, `.cta-button-final`, `.descriptive-guarantee` |
| 5 | 503–689 | **Sales stories** « Mon histoire ne suffit pas. Voici la leur. » | Intro, 5 histoires longues, 4 mini-témoignages, callouts, CTA | `.sales-stories-section`, `.sales-stories-inner`, `.sales-stories-title-stack`, `.ss-intro`, `.ss-objection-card`, `.ss-objection-lines`, `.ss-bridge`, `.ss-story-card`, `.ss-story-header`, `.sales-quote-avatar`, `.ss-avatar-initials`, `.ss-result-tag`, `.ss-story-headline`, `.ss-blockquote`, `.ss-story-punchline`, `.ss-mini-grid`, `.ss-mini-card`, `.ss-mini-card-header`, `.ss-callout`, `.ss-callout--accent`, `.sales-closing-title`, `.ss-final-push`, `.sales-stories-cta` |
| 6 | 691–860 | **Guarantee** (inclut témoignages vidéo) | 3 vidéos review + garantie 30 jours (badge, 3 steps, conditions remboursement, « Pourquoi cette garantie ? ») | `.guarantee-section`, `.video-reviews-block`, `.section-subtitle`, `.video-grid`, `.video-card.fade-in`, `.review-video`, `.custom-play-button`, `.play-icon`, `.pause-icon`, `.guarantee-hero`, `.guarantee-shield`, `.shield-icon`, `.shield-glow`, `.guarantee-content/intro/text-large/main/highlight/highlight-text`, `.guarantee-steps`, `.step-item/number/content/title/description`, `.guarantee-conditions`, `.trust-icon/glow`, `.conditions-title`, `.guarantee-text`, `.guarantee-reassurance`, `.guarantee-pill`, `.guarantee-trust`, `.trust-title`, `.trust-text` |
| 7 | 862–954 | **Modules** « Les 5 modules de ta métamorphose » | Note « 30 premiers jours cadrés » + 5 cartes modules | `.modules-section`, `.modules-heading-anchor`, `.modules-section-heading`, `.modules-intro/kicker/text`, `.modules-grid`, `.module-card.fade-in`, `.module-duration-badge`, `.module-header/number/heading-text/title/subtitle/content/description/unlock` |
| 8 | 956–1029 | **FAQ** | 6 questions accordéon | `.faq-section`, `.faq-container`, `.faq-item`, `.faq-question`, `.faq-toggle`, `.faq-answer` |
| 9 | 1031–1077 | **Final CTA** `#inscription` | H2 « Il y a une raison… », countdown miroir + carte scarcity miroir, CTA final | `.final-cta-section`, `.es2-scarcity-block`, `.offer-countdown-*` (avec `.es2-mirror-days/hours/minutes/seconds`), `.scarcity-card` (`.es2-mirror-places`), `.cta-button-final`, `.final-guarantee` |
| 10 | 1079–1082 | Footer légal | © + lien pages légales | `.invitation-legal-footer` |
| 11 | 1084–1090 | Overlay « offre expirée » (caché) | `#inv-offer-expired-overlay` | `.inv-offer-expired`, `.inv-offer-expired__panel/title/copy/btn` |
| 12 | 6414–6422 | Toast achat (social proof) | `#purchase-toast` « Sophie vient de rejoindre… » | `.purchase-toast`, `.purchase-toast__content/thumb-wrap/thumb/thumb-flag/text/name/action/course` |
| 13 | 7805–7809 | CTA sticky mobile | `🦋 S'inscrire` → `/invitation-es2/` | `.sticky-cta-mobile` |

---

## 2. IDs et classes référencés par le JavaScript inline — ÉLÉMENTS PROTÉGÉS

### IDs référencés par du JS ACTIF (ne pas renommer/supprimer)
- `promo-config` (+ tous ses `data-*` : start, deadline, badge, active, promo-label, banner-message, checkout-code, price-original, price-promo, installment-count, installment-price)
- `offer-days`, `offer-hours`, `offer-minutes`, `offer-seconds` (countdown offre)
- `current-places` (compteur de places — élément SOURCE)
- `scarcity-card` (id présent dans le HTML, ciblé en CSS)
- `inv-offer-expired-overlay` (overlay expiration / réutilisé pour lock acheteur)
- `purchase-toast`, `purchase-toast-flag`, `purchase-toast-text`
- `scarcityBadge` (référencé par updateSeasonalBadge — élément ABSENT du HTML actuel, no-op protégé par if)
- `countdown-timer`, `counter-number` (JS actif L7607–7670 mais éléments ABSENTS — no-ops legacy)
- `inscription` (ancre de section, cible potentielle de `a[href^="#"]`)
- IDs créés dynamiquement par le JS (ne pas réutiliser) : `inv-gate-not-open-overlay`, `inv-gate-not-open-countdown`, `inv-preview-status`, `inv-recovery-email`, `inv-recovery-submit`, `inv-recovery-error`, `promo-banner-dynamic`, `promo-banner-discount`, `promo-banner-countdown`
- Référencés uniquement dans le bloc commenté L7328–7501 (legacy, sans risque) : `scarcity-cta-link`, `sold-out-state`, `cta-text`

### Classes requises par les querySelector/classList du JS ACTIF
- FAQ : `.faq-question`, `.faq-item`, `.faq-answer` + classe d'état `active` (toggle)
- Animations : `.fade-in` (IntersectionObserver)
- Vidéos : `.custom-play-button`, `.review-video`, `.video-card` + attribut `data-video` (1/2/3) + classes d'état `playing`, `paused`, `has-played`
- Badge saisonnier : `.badge-icon`, `.badge-text` (dans `#scarcityBadge`)
- Scarcity : `.scarcity-number`, `.scarcity-denominator`, `.scarcity-meter__fill`, `.scarcity-phase1-total`, `.scarcity-phase2-note` + classe d'état `is-visible`
- Miroirs (sync toutes les 1 s) : `.es2-mirror-places`, `.es2-mirror-days`, `.es2-mirror-hours`, `.es2-mirror-minutes`, `.es2-mirror-seconds`
- Toast : classe d'état `show` ; contenu réécrit en innerHTML avec `.purchase-toast__name/action/course`
- Overlay expiré : `.inv-offer-expired__title`, `.inv-offer-expired__copy`, `.inv-offer-expired__btn` + état `is-visible` ; `<html>` reçoit `inv-offer-lock` et `ready`
- Script promo preview (`?preview=promo`) : `.price-old`, `.price-new`, `.price-installments` (ABSENTS du HTML actuel — no-ops), `[data-unit="days|hours|minutes|seconds"]`
- Sélecteurs génériques actifs : `a[href^="#"]` (smooth scroll), `button[data-jump]` (panneau preview dev), `dataset.ctaTrackedBound` (marqueur `data-cta-tracked-bound` posé par le tracking)

### Contexte du flux (L6675–7319)
- `isPreview = true` codé en dur : « /invitation-xmen : acces libre, aucun gate email/token (copie de /invitation) »
- Token : `?t=` / `?token=` / localStorage `masterclass_es2_token` ; fallback `'preview-invitation'`
- Endpoints : `/.netlify/functions/get-webinaire-registration`, `check-webinaire-eligibility`, `track-webinaire-event` (events : `invitation_visited`, `cta_clicked`, `checkout_clicked`)
- Scarcity : `startScarcityEngine` importé de `../lib/scarcity-engine` (délai `INVITATION_SCARCITY_DELAY_MS` = 60 s, gate `INVITATION_GATE_DELAY_MS` = 1 h après session)

---

## 3. Pattern des liens CTA checkout

**URL unique pour TOUS les CTA : `href="/invitation-es2/"`** (aucun lien direct spiffy.co dans le HTML — Spiffy n'apparaît que dans le snippet head et les sélecteurs JS).

Occurrences (9) :
| Ligne | Classes | Texte |
|-------|---------|-------|
| 171 | `payment-option payment-option--featured payment-option-link scarcity-payment-card` | mini carte 12× 197€ (top) |
| 179 | `cta-button-final scarcity-payment-cta-override` | Commencer ma transformation |
| 467 | `payment-option payment-option--featured payment-option-link` | carte 12 mensualités |
| 474 | `payment-option payment-option-link` | carte 3 mensualités |
| 480 | `payment-option payment-option-link` | carte paiement unique |
| 493 | `cta-button-final` | Commencer ma transformation |
| 685 | `cta-button-final` | Commencer ma transformation (fin sales stories) |
| 1072 | `cta-button-final` | Commencer ma transformation (final CTA) |
| 7807 | `sticky-cta-mobile` | 🦋 S'inscrire |

**Sélecteur `propagateTokenToCheckoutLinks` (L6867)** — identique dans `bindCheckoutClickTracking` (L6874) :
```js
document.querySelectorAll('a[href*="spiffy.co/checkout"], a[href*="/invitation-es2"]')
```
Il APPEND `?t=<token>` (ou `&t=` si `?` déjà présent) à chaque href. Tout nouveau CTA doit donc matcher `a[href*="/invitation-es2"]` (ou spiffy.co/checkout) pour hériter du token + du tracking `cta_clicked`/`checkout_clicked`.
Le script promo preview (L7725) réécrit aussi `a[href*="spiffy.co/checkout/esprit-subconscient-2-0"]` → `/invitation-es2/`.

---

## 4. Section « Ta métamorphose en 5 étapes » (papillon) — VERBATIM (L189–251)

> H2 : **Ta métamorphose** / **en 5 étapes**

**01 — L'aube avant la lumière** (image `1-etape-es.webp`)
« Tu dormais sans le savoir, enveloppé d'une inconscience si familière que tu la prenais pour la vie. Puis cette masterclass a posé des mots sur ce qui te bloquait depuis toujours. La coquille s'est fissurée de l'intérieur. »

**02 — Entre deux mondes** (image `2-etape-es.webp`)
« Tu n'es plus qui tu étais. Pas encore qui tu veux devenir. C'est l'instant clef de ta transformation. Celui où le savoir seul ne protège de rien. Sans matière pour te nourrir, sans action pour avancer, sans structure pour te protéger, sans cela, le papillon meurt avant d'avoir existé. »

**03 — Disparaître pour renaître** (image `3-etape-es.webp`)
« Dans le cocon, la chenille se dissout entièrement. Elle cesse d'être pour devenir autre chose. C'est la loi de toute vraie transformation. On ne devient pas ce qu'on veut en ajoutant. On le devient en laissant mourir ce qu'on était. À l'extérieur, rien ne se voit. À l'intérieur, tout change. »

**04 — Les premiers signes** (image `4-etape-es.webp`)
« Le papillon ne vole pas encore. Mais il sait déjà que le ciel est à lui. Les premières synchronicités arrivent. Une rencontre inattendue. Une porte qui s'ouvre. Une coïncidence trop parfaite pour en être une. Ce ne sont pas des preuves... Tu n'en as plus besoin. Ce sont des confirmations. »

**05 — Ta vraie nature révélée** (image `5-etape-es.webp`)
« Le papillon ne se souvient plus d'avoir été chenille. Il vole... C'est tout ce qu'il connaît. Tu n'essaies plus de changer ta vie. Tu la vis. Tes désirs ne sont plus des rêves, ils sont ta réalité quotidienne. Et au fond de toi, une vérité silencieuse : tu n'es pas devenu quelqu'un d'autre. Tu es enfin qui tu étais depuis toujours. »

Note : les `<h3>` sont splittés `<span>première partie</span> dernière-mot` (ex. `<span>L'aube avant la</span> lumière`).

**Morpho** (le papillon-IA) apparaît ailleurs : Bonus 1 (L378–384) — « Morpho - Ton compagnon IA de transformation » : « 12 mois d'accès à l'application web réservée exclusivement aux membres de la formation. Ton journal quotidien, ton coach IA disponible 24/7 qui te connaît personnellement, ton tableau de progression visuelle. Aucun autre système de développement personnel francophone ne propose ça. Aperçu sur morpho.day » (lien `https://morpho.day`). Valeur 597€.

---

## 5. TOUS les témoignages — VERBATIM

### A. Histoires longues (`.ss-story-card`, L533–613)

**1. Malika** — tag « Résultat en 30 jours » — avatar `Malika.webp`
Headline : « Malika voulait fuir son job. Aujourd'hui, toutes les portes s'ouvrent à elle. »
Corps : « Malika avait peur. Cette peur familière qui paralyse des millions de gens chaque jour. Elle voulait quitter son travail pour lancer son entreprise. Elle savait au fond d'elle que c'était la bonne décision. » / « Mais à chaque fois qu'elle s'apprêtait à passer le cap, son subconscient tirait sur le frein à main. "Et si je me trompe ? Et si je perds tout ? Qui suis-je pour oser ?" » / « Un jour, elle a décidé d'arrêter de tourner en rond et de faire le vrai travail. Le travail intérieur. En profondeur. » / « En un mois, elle a démissionné. Trois semaines plus tard, une pépinière d'entreprises l'a contactée pour participer à un concours d'accélérateur. Sur des centaines de candidats, ils n'allaient en sélectionner que 15. Elle a été sélectionnée. » / « Quelques semaines après, elle a postulé pour une formation universitaire qu'elle convoitait depuis des années. Acceptée aussi. »
Citation : « C'est comme si toutes les portes s'ouvraient à moi. Comme si à chaque obstacle que je rencontrais, une solution se dressait. Et à chacune de mes volontés, les réalisations arrivaient. »
Punchline : « Ce n'est pas de la chance. Ce n'est pas le hasard. C'est exactement ce qui va se passer pour toi après seulement quelques semaines de formation. »

**2. Thierry** — tag « Résultat en 3 semaines » — avatar SVG initiales
Headline : « Thierry pensait qu'à 60 ans, c'était trop tard. Trois semaines ont suffi. »
Corps : « Si tu te dis parfois que c'est trop tard pour toi, lis attentivement ce qui suit. » / « Thierry avait 60 ans quand il a commencé. Une fibromyalgie. Un cancer de la prostate. Une retraite anticipée pour invalidité après dix années de combat. » / « Sa pension était modeste. Son moral fluctuait au jour le jour. Et au fond de lui, une petite voix lui répétait que sa vie, c'était ça maintenant. Qu'il était trop tard. Qu'il avait raté son tour. »
Citation : « En à peine trois semaines, j'ai retrouvé ma joie de vivre et la capacité à gérer le stress et les soucis quotidiens sans être envahi par des pensées négatives. La formation a été une révélation. »
Punchline : « Trois semaines. À 60 ans. Après une décennie de combat contre la maladie. Si Thierry a pu reprogrammer son cerveau dans ces conditions-là, qu'est-ce qui serait possible pour toi ? »

**3. Sasha** — tag « Résultat en 4 jours » — avatar `Sasha.webp`
Headline : « Sasha doutait. Quatre jours ont suffi pour qu'elle voie clair. »
Corps : « Sasha avait passé des années à consommer du contenu de développement personnel sans jamais voir de transformation s'opérer. Elle commençait à se demander si le problème, ce n'était pas elle. »
Citation : « Après seulement 4 jours, cette formation m'a redonné un énorme coup de boost pour la poursuite de mes rêves. Je me suis reconnue dans les schémas et je sais maintenant exactement ce que je dois faire pour y arriver. »
Suite : « Ce qui a changé pour Sasha en quatre jours, ce n'est pas qu'elle a appris des techniques magiques. C'est qu'elle s'est vue dans le miroir pour la première fois. Et qu'elle a enfin compris pourquoi rien n'avait marché jusque-là. »
Punchline : « C'est exactement ce qui va se passer pour toi après seulement 4 jours de formations. Et ce n'est que la pointe de l'iceberg. Parce que la formation dure 6 mois. 🤯 »

**4. Cyril** — tag « Résultat en 21 jours » — avatar `Cyril.webp`
Headline : « Cyril était sceptique. 21 jours plus tard, il avait changé d'avis. »
Corps : « Cyril s'est inscrit en se disant "si ça marche pas, ça marche pas, j'aurai au moins essayé." Il n'attendait rien de spécial. Il avait été déçu trop de fois. »
Citation : « En seulement 21 jours, j'ai pu constater de réels changements dans ma vie quotidienne et dans ma façon d'aborder les défis. C'est un investissement qui en vaut vraiment la peine. Franchement, n'hésitez pas : foncez, vous ne le regretterez pas. »
Suite : « Cyril n'avait pas de don particulier. Pas de discipline supérieure. Il n'a pas pris de raccourci. Il a juste fait le travail. Et sa vie a commencé à changer en moins d'un mois. »
Punchline : « Pardon, j'ai dit une bêtise. Cyril a en fait pris un raccourci. Celui d'arrêter de chercher des raccourcis et de travailler sur la seule chose qui compte vraiment : LUI-MÊME. »

**5. Daniel** — tag « Résultat en 2 semaines » — avatar SVG initiales
Headline : « Daniel ne croyait plus pouvoir changer. Deux semaines lui ont prouvé le contraire. »
Corps : « Daniel avait essayé. Tellement essayé. Trop d'années à tenter, trop d'années à échouer. Une partie de lui avait fini par accepter que la vie dont il rêvait n'était peut-être pas pour lui. »
Citation : « Je suis inscrit depuis environ 2 semaines, et je ressens déjà un profond bien-être. Cette formation m'aide à travailler sur moi-même en profondeur, que ce soit en matière d'abondance, d'amour ou de confiance en soi. »
Punchline : « Deux semaines. C'est moins que le temps qu'il faut à la plupart des gens pour décider qu'ils ont besoin de "réfléchir un peu plus" avant de se lancer. Pendant ce temps-là, Daniel changeait déjà. »

### B. Mini-témoignages (`.ss-mini-card`, L617–646)
- **Pascaline, 42 ans** (avatar `Pascaline.webp`) : « Une vraie révélation. Les exercices m'ont permis de voir mes blocages autrement et de redéfinir mes priorités. »
- **Greg (me suit depuis 2018)** (avatar `greg.webp`) : « Le contenu est juste DINGUE. Un vrai game changer. »
- **Beven** (avatar `beven.webp`) : « C'est la meilleure formation que j'ai suivie pour me développer personnellement. »
- **Peter** (avatar `Peter.webp`) : « Je n'ai jamais connu, vécu ou perçu une formation d'une telle ampleur, avec un tel impact. C'est comme si le plus grand magicien du monde vous transmettait ses plus grands secrets sans aucune retenue. Et je ne suis pas payé pour écrire tout ça. »

### C. Témoignages VIDÉO (`.video-card`, L702–756, dans la guarantee-section)
Titre : « Témoignages Vidéo » — sous-titre « Découvre les expériences réelles de nos participants »
1. `data-video="1"` : `https://sonnycourt-videos-public.b-cdn.net/review%20Malika%20(Sans%20Date%20et%20avec%20compression).mp4` (review Malika)
2. `data-video="2"` : `.../TÉMOIGNAGES%20-%20Vidéos/john.lelong95310%40gmail.com%20(John).mp4` (John)
3. `data-video="3"` : `.../TÉMOIGNAGES%20-%20Vidéos/Emilie.Tasserit%40Outlook.Fr%20(Emilie).mp4` (Emilie)
Fallback texte : « Ton navigateur ne supporte pas la lecture de vidéos. » Boutons play/pause custom `.custom-play-button` avec `data-video` correspondant.

**Total : 12 témoignages** (5 histoires + 4 minis + 3 vidéos). Le toast social proof (`#purchase-toast`, « Sophie vient de rejoindre Esprit Subconscient 2.0 ») est généré par le scarcity engine, pas un témoignage réel.

---

## 6. Section prix / offre actuelle

### Carte récap valeur (L409–425, dans `.es2-bonus-grid`)
`.es2-price-summary-card` > `.es2-price-simple` :
- Badge : « Offre réservée aux participants de la masterclass »
- Gauche : « Valeur totale » → « 3 988€ » (barré)
- Droite : « Offre spéciale » → « 197€/mois », sub « 12 mensualités »

### `.price-reveal-section` (L430–489)
- L432–458 : `.es2-scarcity-block` — carte scarcity DUPLIQUÉE (mêmes classes que le top, compteur `.scarcity-number.es2-mirror-places`, dénominateur « / 10 »)
- L460–465 : H2 « ☕️ Choisis ton plan » / « Ta transformation pour le prix d'un Starbucks par jour »
- L466–487 : `.payment-options` — 3 cartes-liens (`/invitation-es2/`) :
  1. `payment-option--featured` badge « Le plus populaire » : « 12 mensualités » — **197€/mois** — « Ça fait 6.56€ par jour » + image `paiements.webp`
  2. « 3 mensualités » — **697€** — « par mois »
  3. badge muted « MEILLEUR TARIF » : « Paiement unique » — **1 997€** — « en une fois »
- L492–497 : `.descriptive-cta` — bouton « Commencer ma transformation » + « ✓ Garantie satisfaction 30 jours »

### Rappels prix ailleurs
- Mini carte top (L169–184) : 12 mensualités 197€/mois, 6.56€/jour, badge « Le plus populaire »
- Bonus : Morpho 597€, Volt 997€, consultation Sonny 497€ (somme avec formation = 3 988€ de « valeur totale »)

---

## 7. FAQ — VERBATIM (L956–1029, 6 items)

**Q1. Combien de temps dure la formation ?**
« Esprit Subconscient 2.0 contient plus de 36 heures de contenu réparties sur 5 modules. Les 30 premiers jours sont structurés avec une leçon par jour. Après le jour 30, tu as accès libre à l'intégralité du programme pour avancer à ton rythme. »

**Q2. Quelle durée quotidienne devrais-je consacrer à la formation pour obtenir des résultats ?**
« 15 à 20 minutes par jour suffisent. Une leçon le matin, un exercice le soir. C'est la régularité qui fait la différence, pas la quantité. »

**Q3. Ai-je besoin d'avoir des connaissances préalables pour suivre cette formation ?**
« Pas du tout. Que tu sois débutant(e) en développement personnel ou que tu aies déjà des années de pratique, la formation est conçue pour t'amener plus loin que tout ce que tu as vu jusqu'ici. »

**Q4. Je n'ai pas d'ordinateur. Est-ce que je peux suivre la formation depuis mon smartphone ou une tablette ?**
« Oui. La formation est accessible depuis n'importe quel appareil - smartphone, tablette ou ordinateur. Une grande partie du contenu est au format audio, ce qui te permet de l'écouter partout sans rester devant un écran. »

**Q5. Si le contenu ne me plaît pas, est-ce que je serai remboursé(e) ?**
« Tu as **30 jours pour tester réellement** la formation. La seule condition pour le remboursement intégral, c'est de l'avoir vraiment essayée :
- Module 1 — avoir suivi le module entier
- Module 2 — avoir suivi le module entier
- Module 3 — avoir suivi uniquement la leçon 1
C'est volontairement une preuve d'engagement, pas un piège : on tient à ce que chaque personne ait vraiment fait l'expérience avant de juger. Si après avoir complété ces étapes tu n'es pas satisfait(e), tu envoies un simple email à support@sonnycourt.com avant la fin de tes 30 jours et tu es **remboursé(e) intégralement sous 48 heures ouvrables**, sur le moyen de paiement d'origine. On pourra prendre un court moment avec toi pour comprendre ce qui n'a pas fonctionné, mais si tu souhaites toujours être remboursé(e), **c'est fait, sans forcing**. On vérifie nous-mêmes ta progression directement sur la plateforme.
Ce filtre nous permet de te promettre des résultats — parce qu'on sait qu'à ce stade, tu as vraiment expérimenté la méthode. »

**Q6. Que se passe-t-il après que je me sois inscrit(e) ?**
« Après ton inscription, tu accèdes immédiatement à la plateforme Volt et au Module 1. Chaque jour, une nouvelle leçon se débloque automatiquement. Au jour 30, l'intégralité du programme est accessible à vie. Tu es libre de revenir sur n'importe quelle leçon quand tu veux. »

---

## 8. Countdown temps et compteur de places

### Countdown offre (temps)
- **Source** (scarcity-section top, L136–141) : `#offer-days`, `#offer-hours`, `#offer-minutes`, `#offer-seconds` — mis à jour chaque seconde par `updateInvitationOfferCountdown()` (L6750) depuis `offerExpiryMs` (venant de `get-webinaire-registration.offreExpiresAt`, sinon `getCurrentWindow().endMs` du scarcity-engine).
- **Miroirs** (final CTA, L1041–1044) : `.es2-mirror-days/hours/minutes/seconds` — copiés depuis les IDs source par `syncMirrorScarcity()` toutes les 1 s (L7677–7702).
- À expiration : `lockInvitationOfferExpired()` → affiche `#inv-offer-expired-overlay` + classe `inv-offer-lock` sur `<html>`.
- Legacy inactif : `#countdown-timer` (minuit) et `#counter-number` (animation 2 847) — code actif mais éléments absents.

### Compteur de places
- **Source** : `#current-places` (L159, `.scarcity-card#scarcity-card` de la scarcity-section top). Alimenté par `startScarcityEngine` (`../lib/scarcity-engine`) via `onSeatsLeft` → aussi tous les `.scarcity-number`.
- **Miroirs** : `.scarcity-number.es2-mirror-places` dans la carte dupliquée du price-reveal (L449) et du final CTA (L1062) — sync 1 s + `updatePhaseUi` (qui met à jour TOUS les `.scarcity-number`).
- **Phases** : phase1 = « X / 30 » ; phase2 = affiche `.scarcity-phase1-total` (« Sold out 30/30 ») + `.scarcity-phase2-note` (« 10 places rouvertes ») via classe `is-visible`, dénominateur passe à « / 10 ». Barre `.scarcity-meter__fill` en % largeur.
- **Toast lié** : `#purchase-toast` + `#purchase-toast-flag` + `#purchase-toast-text` (notifications d'achat du engine, classe `show`).
- Les 3 cartes scarcity (top L143–167, price-reveal L433–457, final L1046–1070) partagent les mêmes classes ; seul le top a les IDs.
