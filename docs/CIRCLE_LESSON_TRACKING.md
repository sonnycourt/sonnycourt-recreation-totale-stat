# Suivi ES2 — état de livraison

## État (15 octobre 2026)

**Publié et actif pour les cinq modules ES2 le 15 octobre 2026.**
Fusion autorisée sur main : `ced3688`. Publication via le sas sécurisé,
déploiement `6ad0ca22231dafeecfaf9eb0`, production vérifiée et verrouillée.
Test réel de production réussi : tâche Circle
`367cf9e7-b0b8-4e67-aace-ec807b63c132`, réponse 200, `stored=true`,
`identified=true`. SELECT Supabase : ligne `id=2`, membre administrateur
`26280536`, leçon `4232148`, réception `2026-10-15 12:47:26.086023+00`
(14 h 47 Zurich). Progression administrateur restaurée à 0/5 et inscription
temporaire retirée après vérification. Les deux lignes de test administrateur
restent conservées et sont à exclure des analyses d'élèves.

SQL exécuté par Sonny et confirmé par SELECT : table et vue présentes, RLS
activée, aucun droit anon/authenticated, service_role INSERT/SELECT sans DELETE.
Build complet réussi (325 pages), onze tests locaux réussis. Le blocage de 4 Ko
est résolu en exportant ce nouveau récepteur au format moderne Request/Response
Netlify ; aucune fonction existante ni variable existante n'a été modifiée.
Preview vérifiée par le sas, y compris le démarrage MC2 :
`https://6ad0c504426f2d32d152b599--sonnycourt-recreation-totale.netlify.app`.
Les quatre nouvelles variables Circle sont configurées ; collecte `true` en
production et en contexte deploy-preview. Le workflow utilise uniquement
`https://sonnycourt.com/.netlify/functions/circle-lesson-progress`, avec la
capacité secrète dédiée (non reproduite ici), sans paramètre `probe`.

Le compte Scale accepte réellement le déclencheur « Leçon terminée » et l'action
« Envoyer vers webhook » : activation et exécution réussies, sans nouvel achat.

Workflow Circle actif (état confirmé par l'API après publication) :
`1be305bd-f9dc-422e-ba87-9365c36e4744`.
Nom : `ES2 — Historique des leçons → Supabase`.
Son déclencheur est limité au groupe ES2 `1130490` (`SpaceGroup`), sans filtre
d'audience. Les cinq espaces autorisés côté serveur constituent une seconde
restriction. Une seule action : webhook ; aucun message ou changement d'accès.

Le vrai événement observé le 15 octobre contient :

```json
{"body":{"type":"courses_lesson_completed","data":{"community_id":214213,"community_member_id":26280536,"space_id":2758877,"courses_section_id":1110303,"lesson_id":4232148}}}
```

Ce membre est exclusivement le compte administrateur Sonny Court. Le test
synthétique de l'éditeur omettait la leçon, mais le vrai événement l'inclut bien.
Il ne fournit ni date source ni identifiant d'événement : utiliser l'heure de
réception Supabase, jamais une heure de clic certifiée.

Preuve bout en bout : tâche Circle `b9878e46-aae7-460c-9465-3218332bf37d`, succès,
réponse `{stored:true,identified:true}`, statut 200. SELECT Supabase confirmé :
ligne `id=1`, leçon `4232148`, membre `26280536`, `received_at` égal à
`2026-10-15 12:27:21.483426+00` (14 h 27 Zurich), état `identified`.
Cette ligne de test admin est conservée dans l'historique privé et doit être
exclue de toute analyse d'élèves. La progression a été remise à 0/5 et
l'inscription temporaire retirée (absence vérifiée par GET). Aucun élève,
paiement ou message modifié.

## Installation

1. Sonny exécute `sql/circle_lesson_tracking.sql` et confirme
   `lesson_tracking_ready = true`. Le SQL est réexécutable et a été testé sur
   Postgres embarqué. Ne jamais l'exécuter à sa place dans Supabase.
2. Configurer dans Netlify, scope functions uniquement, des variables nouvelles :
   - `CIRCLE_LESSON_WEBHOOK_SECRET` : 32 octets aléatoires minimum, secret dédié ;
   - `CIRCLE_LESSON_COMMUNITY_ID=214213` ;
   - `CIRCLE_LESSON_ALLOWED_SPACE_IDS=2758877,2758883,2758880,2758879,2758884`
     (modules actuels 1 à 5, vérifiés par GET Admin API le 15 octobre) ;
   - `CIRCLE_LESSON_TRACKING_ENABLED=false` jusqu'au test complet ;
   - les variables Supabase serveur existantes sont réutilisées.
3. Preview via `npm run deploy:preview`. Le récepteur ne fait rien sans secret
   et périmètre. Ne pas modifier les fonctions d'achat ou d'onboarding.
4. Dans un workflow réservé au compte test, utiliser
   `https://<preview>/.netlify/functions/circle-lesson-progress?key=<secret>&probe=1`.
   Le mode probe ne stocke rien et ne renvoie que des noms de champs et booléens.
   Vérifier un vrai événement de validation (pas seulement le test synthétique),
   puis dévalidation/revalidation. Ne pas envoyer d'email ou de notification.
5. Confirmer le champ réel de la leçon, l'horodatage éventuel et l'identifiant
   d'événement. Adapter le parseur et les tests à l'événement réellement observé.
   Vérifier aussi les validations depuis l'application mobile.
6. Après validation, publication par le sas sur main propre et synchronisée,
   endpoint de production sans `probe=1`, activation du flag et du workflow ES2.
   Vérifier un événement en base avant d'annoncer que le suivi est opérationnel.

## Comportement et sécurité

- Aucun accès, paiement, email, validation de leçon ou remboursement modifié.
- Authentification par capacité URL dédiée (l'éditeur Circle n'expose pas de
  champ d'en-tête). Ne jamais mettre une clé Supabase/Circle dans cette URL.
  Restreindre l'accès aux logs des plateformes et ne jamais journaliser l'URL.
- Les données sont privées : RLS, aucun droit anon/authenticated ; service_role
  n'a que SELECT/INSERT sur la nouvelle table. Pas de page publique de lecture.
- Timestamp réception généré par Postgres ; timestamp Circle séparé s'il existe.
  Ne jamais présenter l'heure de réception comme une heure source certifiée.
- Événements sans leçon conservés avec `needs_lesson_id`, jamais attribués au hasard.
- Sans ID d'événement fourni, deux réceptions identiques restent deux lignes :
  impossibilité de distinguer sûrement retry et nouvelle validation. Ne pas
  transformer ce nombre brut en nombre de leçons distinctes ou en preuve d'abus.
- Si la base échoue, réponse 503, jamais faux succès. Vérifier la politique de
  retries Circle avec le test complet ; la livraison sans perte n'est pas encore
  démontrée. Historique Circle à utiliser pour reprendre les échecs si nécessaire.
- Pas de récupération rétroactive de dates inventées, pas de verdict de garantie.

## Lecture (SQL en lecture seule)

```sql
select community_member_id, lesson_id, provider_occurred_at, received_at,
       previous_lesson_id, seconds_since_previous, interval_basis,
       resolution_status
from public.circle_lesson_timeline
where community_member_id = 123
order by received_at, id;
```

Les identifiants Circle sont stables. La correspondance avec les noms des élèves
et les titres se lit via l'API Circle existante ; aucune fusion par email flou.

## Tests locaux

`node --test scripts/circle-lesson-tracking.test.mjs scripts/circle-lesson-sql.test.mjs`

Rollback : désactiver ce nouveau workflow et le flag de collecte ; conserver
l'historique. Les automatismes d'accès existants restent indépendants.
