# Delta Vision — tracking interne

## Périmètre

Seulement `/delta-vision/`, les checkouts 41049 (27 EUR), 41096 (47 EUR), et le nouvel espace `/admin/delta-vision-analytics/`. Aucun changement MC2, paiement, webhook d’achat, groupe MailerLite ou communication client.

## SQL et accès

Sonny exécute `sql/delta_vision_analytics.sql` dans Supabase. Le dernier résultat doit être `delta_analytics_ready = true`. La migration a été exécutée deux fois dans PostgreSQL local de test. Aucune migration distante n’est exécutée par l’agent.

Le tableau de bord utilise le cookie administrateur ES2 existant et son écran de connexion. La page HTML publique ne contient aucune donnée privée ; l’API refuse les visiteurs non authentifiés. Les événements et la fonction de rapport sont inaccessibles aux rôles anon/authenticated.

## Mesures

- Une visite = un chargement de page, commencé après consentement. Un retour BFCache conserve cette visite. Le même navigateur est reconnu 90 jours au maximum après son dernier passage ; pas de rapprochement inter-appareils.
- Accord statistiques existant de moins de 180 jours repris ; sinon choix Accepter/Refuser de même importance. Retrait disponible en bas de page ; il arrête les envois et efface l’identifiant local. Aucun événement ni identifiant analytique n’est créé avant accord.
- Temps actif = onglet visible, activité dans les 60 dernières secondes ou vidéo en lecture. Ce n’est pas une preuve d’attention humaine. Temps de section = section visible pendant ce temps actif, plusieurs sections peuvent se chevaucher.
- Profondeur = bas du viewport / hauteur de page. CTA exposé = visible au moins une seconde. CTA cliqué = clic gauche ou ouverture par clic milieu ; ouvrir via menu contextuel peut manquer le clic, mais le lien conserve sa référence.
- Vidéo = clic demandé, lecteur prêt, play réel, pause, seek, fin. Seuls les intervalles contigus lus dans un onglet visible alimentent le temps regardé. Les retours sont dédupliqués dans la durée unique. Tranches de rétention 10 secondes, au moins 1 seconde réellement lue pour compter une visite.
- Performances disponibles : LCP et chargement (échantillons reçus après consentement), délai clic-play → premier événement play. Signal absence de play à 10 secondes, erreurs API/lecteur/JS sans contenu d’erreur ni URL sensible.
- Données envoyées par lots, retries avec identifiants idempotents, mémoire bornée, pas de blocage de navigation en cas d’indisponibilité. Perte résiduelle possible si le navigateur interrompt une requête.

## Spiffy

Le script `spiffy/delta-vision-analytics.html` est ajouté aux scripts existants des deux checkouts, sans remplacer leur capture email ni lire aucun champ bancaire. Il signale le chargement de la page, pas la disponibilité garantie de chaque moyen de paiement.

Les liens consentis portent `dv_visit` et `utm_term=dv1_<UUID de visite>`. Source/medium/campagne sont transmis si présents. L’API admin lit Spiffy à la demande (bouton Vérifier les ventes) : commande Delta Vision + paiement succeeded + montant effectif en EUR + référence exacte non ambiguë dans attribution/preserved_params. Aucune attribution par email, IP, proximité temporelle ou navigateur supposé.

Une commande réelle issue du nouveau lien est nécessaire pour valider le bout-en-bout de conservation de cette référence par Spiffy. Aucun achat réel n’est déclenché pour tester. Sans référence, la vente reste explicitement non rattachée. Les achats antérieurs à l’installation ne peuvent pas être attribués rétroactivement.

Les ventes sont recherchées du début de période jusqu’à maintenant pour suivre les conversions tardives des visites sélectionnées. Les ventes non rattachées peuvent appartenir à d’autres filtres. Encaissement initial net = premier paiement réussi moins ses remboursements ; hors frais, taxes, autres échéances. Jamais une valeur contractuelle projetée.

Le filtre API Spiffy `filter[created_at.gte]` doit recevoir `AAAA-MM-JJ` (un horodatage ISO complet déclenche une erreur 500 constatée). Une journée tampon est demandée, puis la borne UTC précise est appliquée côté serveur. Aucun filtrage approximatif des ventes affichées.

## Exploitation

Rapports de 31 jours maximum dans les 90 derniers jours, 10 000 visites maximum (erreur explicite au-delà, réduire la période). Lecture Spiffy bornée à 500 commandes et environ 18 secondes avant la prochaine requête ; aucune estimation si la réponse est incomplète. Le quotidien Netlify `delta-vision-analytics-retention` supprime uniquement les événements de plus de 90 jours. Cette première version n’ajoute pas de session replay ni de capture de saisie.

La couverture absolue n’est pas connue : consentement refusé, bloqueurs, scripts empêchés et visites localhost/preview exclus. Les chiffres sont des mesures du trafic instrumenté, pas le total de toutes les personnes. Les corrélations entre vidéo et achat ne démontrent pas un effet causal.

## Tests

`node scripts/delta-vision-analytics-smoke.mjs`

`node scripts/delta-vision-analytics-client-smoke.mjs`

`node scripts/delta-vision-video-smoke.mjs`

`node scripts/delta-vision-urgency-smoke.mjs`

Plus build Astro, contrôle visuel desktop/mobile, garde-fous du déploiement et vérifications de production sans achat ni communication de test.
