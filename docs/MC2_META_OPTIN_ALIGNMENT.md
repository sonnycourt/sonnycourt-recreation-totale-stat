# Alignement de /meta/mc2/ — 7 septembre 2026

## Périmètre

- `/meta/mc2/` rend directement la page `/mc2/`, avec les props `trafficSource="meta_ad"` et `trackingPath="/meta/mc2/"`.
- Même texte, images, mise en page mobile/desktop, bloc 197 € barré → GRATUIT, parcours et formulaire natif à trois étapes.
- Plus de dépendance de cette route à l'ancienne page publicitaire, au patch global de `fetch`/Storage/cookies ou au sélecteur de créneaux injecté après coup.
- `/meta/masterclass/` et `/tt/mc2/` ne sont pas modifiés.
- Aucun changement du serveur d'inscription, des pages confirmation/live/replay, de l'offre, du checkout, des automations ou du schéma Supabase.

## Attribution Meta

- Pixel existant : `3367958190030822`, chargé en différé ou dès interaction.
- UTM, `fbclid`, `_fbc`, `_fbp`, source `meta_ad`, variante `mc2_meta_v5` et identifiant du parcours transmis aux deux captures (email, puis inscription complète).
- Attribution conservée 30 jours lorsque le stockage est disponible ; les paramètres de l'URL sont conservés même si le navigateur bloque le stockage.
- Un nouvel identifiant de clic prend priorité sur l'ancien cookie `_fbc` ; l'horodatage d'un même clic reste stable au rechargement.
- `EmailCaptured` et `Lead` navigateur ne partent qu'en réponse aux événements confirmés par `register-mc2`, avec les mêmes identifiants que la CAPI existante.
- Pas de conversion `Lead` à la simple saisie de l'email. Pas de pixel sur la route organique ; pas de pixel dans les tests locaux/`preview=dev`/trafic interne.
- Les autres événements du funnel (présence, progression, offre, checkout, achat) restent gérés par le backend MC2 existant.

## Vérifications effectuées

- `npm run build` : OK, 306 pages.
- `node scripts/mc2-meta-optin-smoke.mjs --built` : OK. Le HTML compilé des deux routes est strictement identique après normalisation des deux attributs d'attribution.
- Le même test exécute le vrai code d'inscription dans une simulation : JIT + deux créneaux fixes, source Meta + source organique, capture partielle + complète, dates/créneaux, consentement SMS, redirection MC2, événements et déduplication.
- `npm run test:mc2-meta-events` : OK (CAPI simulée).
- `npm run test:mc2-session-capacity` : OK (inclut volontairement un cas d'erreur RPC 404 simulé).
- `node scripts/mc2-offer-deadline-smoke.mjs` : OK.
- `npm run test:mc2-session-emails` : OK.
- Parcours navigateur local : sélection 20 h, trois étapes, confirmation atteinte en mode « AUCUNE INSCRIPTION RÉELLE ».
- Affichage mobile 390 px et desktop 1440 px vérifié, sans débordement horizontal ; titre desktop non tronqué.

## Limites / non-régressions identifiées

- `scripts/mc2-session-access-smoke.mjs` échoue déjà sur `origin/main` : son assertion recherche textuellement `const expiryMs`, alors que la page live utilise `let expiryMs`. Même résultat sur le checkout de référence non modifié ; aucun changement de ce test ou de la page live dans ce travail.
- La confirmation en `preview=dev` utilise son créneau JIT de démonstration. Le transport des vrais créneaux est vérifié dans les tests de requêtes ; ce comportement de preview n'a pas été changé.
- Aucun test de réception réel dans Meta Events Manager, aucune inscription client, aucun email/SMS et aucun achat réel effectués.
- Préparation locale uniquement ; aucun push ni déploiement effectué. Ne pas annoncer la nouvelle page en production avant publication via `npm run deploy:production` depuis un main propre et synchronisé.

## Relire en local

`http://127.0.0.1:4334/meta/mc2/?preview=dev`

Branche : `codex/align-meta-mc2-optin`.
