# Delta Vision — compteur sans cookies

Périmètre strict : `/delta-vision/` en production. Aucun changement du tracking
détaillé consenti, des checkouts, de MC2 ou des emails. Aucun nouveau fournisseur.

Une requête POST sans cookies, referrer ni paramètres est envoyée au premier
affichage visible de chaque document. Le corps est constant (`view`). Pas de
localStorage/sessionStorage, empreinte, UTM, ID navigateur ou ID de visite. Pas
de retry ni de nouveau comptage au retour BFCache. Un rechargement compte à
nouveau. Les pages de preview et les navigateurs automatisés sont exclus.

Netlify Blobs `delta-anonymous-pageviews-v1` conserve des marqueurs indépendants
`heure UTC/UUID serveur` dont le contenu est `1`. UUID non exposé au navigateur,
sans lien entre chargements. Ni IP, user-agent, URL, date précise, email, source,
identité ni achat dans ce stockage. Les en-têtes HTTP sont traités transitoirement
pour rejeter les robots évidents et les requêtes cross-origin. Les journaux et
protections opérationnels de l’hébergeur restent distincts de ces statistiques.

Rapport agrégé par heure réservé à la session admin existante :
`/admin/delta-vision-analytics/`. Aucun filtrage ou rapprochement avec les profils
consentis. Lecture complète paginée par le SDK ; au-delà de 50 000 chargements,
erreur explicite plutôt qu’un total tronqué. Purge quotidienne des marqueurs de
plus de 90 jours dans ce seul store. Aucun SQL requis.

Limites : compteur de chargements, **pas de personnes uniques** ; il ne mesure
pas les pages sans JS, requêtes bloquées, visites jamais visibles ou échecs réseau.
Le filtre de robots n’est pas une preuve d’humanité et le compteur public peut
être artificiellement augmenté. Aucun historique reconstruit avant publication.

L’exemption de consentement ne résulte pas simplement de l’absence de cookies :
finalité limitée à la mesure d’audience, statistiques anonymes, pas de recoupement
ni réutilisation publicitaire, information utilisateur dans le pied de page.
Référence : https://cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience

Vérification : `node scripts/delta-pageviews-smoke.mjs` ; tests du tracking
détaillé existant et build Astro. Vérifier après publication un chargement avec
refus : un POST `view`, sans cookie ni referrer, aucun POST détaillé.
