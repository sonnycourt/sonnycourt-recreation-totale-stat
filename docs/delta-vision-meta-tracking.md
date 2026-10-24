# Delta Vision — pixel Meta et CAPI

Périmètre : `/delta-vision/` et ses fonctions `delta-vision-register` et
`delta-vision-purchase`. Aucun changement de MC2, des emails ou du schéma Supabase.

## Qui est mesuré

Le pixel Meta (même pixel que MC2) se charge seulement si la visite vient d'une
pub Meta : paramètre `fbclid`, ou `utm_source` parmi meta, meta_ad, facebook,
fb, instagram, ig. Cette origine est mémorisée 7 jours dans le navigateur
(`localStorage dv_meta_source_v1`) pour couvrir le retour et l'achat.
Un visiteur organique ne charge aucun script Meta : le compteur sans cookie et la
mesure consentie restent inchangés.

## Lien à utiliser dans la pub

`https://sonnycourt.com/delta-vision/?utm_source=meta_ad&utm_medium=paid&utm_campaign=<campagne>&utm_content=<creative>`

Meta ajoute `fbclid` tout seul. Les UTM sont aussi lus par la mesure consentie
(colonnes source, medium, campaign) et par Spiffy (attribution de la commande).

## Événements

| Moment | Navigateur | Serveur (CAPI) |
|---|---|---|
| Arrivée | PageView, ViewContent (97 ou 147 EUR) | — |
| Ouverture du popup | InitiateCheckout | — |
| Email validé (étape 1) | Lead, `eventID` = uuid | Lead, même `event_id` (déduplication) |
| Paiement Spiffy confirmé | — | Purchase, `event_id` = `dv-purchase-<order_id>` |

À l'étape 1, le navigateur joint `meta` (fbc, fbp, UTM, eventId) à l'inscription.
La fonction `delta-vision-register` envoie le Lead CAPI puis mémorise l'attribution
dans Netlify Blobs `delta-meta-attribution-v1` (clé = SHA-256 de l'email). Le
webhook `delta-vision-purchase` relit cette entrée, envoie le Purchase avec fbc/fbp
et l'efface. Un acheteur organique n'envoie rien à Meta. Purge quotidienne à 30 jours
(`delta-meta-attribution-retention`).

La CAPI reste muette hors production (`CONTEXT` ≠ production), comme pour MC2.
Variables déjà présentes : `META_PIXEL_ID`, `META_ACCESS_TOKEN`. Aucune variable ajoutée.

## Vérification

`npm run test:delta-vision-meta` ; puis sur la preview, ouvrir la page avec
`?fbclid=test1234567890` et contrôler les appels `fbq` (PageView, ViewContent,
InitiateCheckout, Lead). En production : Gestionnaire d'événements Meta, pixel
3367958190030822, événements avec `content_name` Delta Vision.
