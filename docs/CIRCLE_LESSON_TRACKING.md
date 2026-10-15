# Suivi ES2 — état de livraison

## État (15 octobre 2026)

Récepteur et SQL préparés, tests locaux passants. **Pas activé en production.**
Ne pas annoncer une collecte effective avant le contrôle bout en bout ci-dessous.

Build complet réussi (325 pages), neuf tests locaux réussis. La preview via le
sas échoue à la création d'une fonction : Netlify renvoie « Your environment
variables exceed the 4KB limit imposed by AWS Lambda ». Aucune variable existante
n'a été supprimée, aucun changement de runtime/abonnement n'a été effectué.
Résoudre ce problème de configuration séparément avant de reprendre le test
Circle réel ; ne pas contourner le sas de déploiement.

L'interface du compte Scale permet de choisir « Leçon terminée » puis « Envoyer
vers webhook ». Cela contredit la restriction Plus de la documentation publique :
l'éligibilité finale doit encore être confirmée lors du test/activation, sans achat.

Brouillon Circle créé, non activé :
`1be305bd-f9dc-422e-ba87-9365c36e4744`.
Nom : `ES2 — Suivi des leçons — BROUILLON NON ACTIF`.
Son déclencheur est provisoirement « toutes les leçons communauté » et sa sortie
n'est pas finalisée. **Restreindre aux modules ES2 avant activation.**
Un test vers la future route inexistante a échoué normalement (aucune donnée
Supabase écrite). Le corps affiché par le test Circle est :

```json
{"body":{"type":"courses_lesson_completed","data":{"community_id":214213,"community_member_id":123,"space_id":1}}}
```

L'identifiant membre ci-dessus est anonymisé. Cet exemple ne comporte ni leçon,
ni date, ni identifiant d'événement. Les champs facultatifs du parseur sont des
formats à confirmer avec un vrai événement, pas une capacité déjà vérifiée.
Si le vrai événement omet également la leçon, NE PAS activer ce montage pour les
élèves : il faudra un workflow par leçon avec une association serveur vérifiée,
ou une autre source native. Aucun rapprochement par dernière leçon supposée.

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
