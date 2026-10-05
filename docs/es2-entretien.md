# Entretien personnel ES2

## Parcours élève

`/es2-entretien/` s’ouvre depuis un lien personnel. Le bouton commence ou reprend le même entretien. Une seule question est affichée ; l’historique reste accessible dans « Relire mes réponses ». Les réponses sont sauvegardées après envoi, pas pendant la saisie.

Le serveur dirige treize sujets : situation, état quotidien (choix multiples), exemple concret, enfance facultative, vision, ressenti face aux désirs (choix unique), résistances, tournants de vie, ressources (choix multiples), matin, journée, soirée, question pour Sonny. Six sujets autorisent au plus une relance utile. Les transitions ne peuvent pas sauter arbitrairement des sujets. Les refus restent possibles, l’histoire personnelle n’est jamais une cause présumée. Un risque immédiat arrête la collecte et rappelle l’absence de suivi en direct.

Les écrans de choix fixes sans texte libre et le bouton Passer avancent immédiatement sans appel IA. Les réponses libres sont traitées par Anthropic avec streaming, un format JSON court et un effort faible pour le dialogue. Le modèle de fond reste `claude-fable-5-1` sauf configuration explicite. Le worker publie seulement le texte visible partiel, au plus toutes les 650 ms ; le navigateur vérifie toutes les 850 ms. Un résultat final reste validé et enregistré avant la question suivante. Le délai dépend aussi d’Anthropic et de la connexion. L’animation locale ne dépasse pas 900 ms.

La question finale clôt automatiquement l’entretien et lance le dossier, même si le navigateur est fermé. Le bouton Arrêter ici reste accessible pour une clôture anticipée. Plafond de sécurité : 20 réponses, 4 000 caractères par réponse, 100 000 cumulés. Une clôture ne permet plus d’ajouter de message. La confirmation annonce la réponse personnelle de Sonny sous 7 jours ; le système n’envoie ni email ni rappel automatiquement.

## Espace privé de Sonny

`/admin/es2-entretiens/`, mot de passe habituel de l’espace privé.

1. Créer/retrouver le lien avec le prénom et l’email. Un email normalisé possède exactement une ligne et une conversation. Une invitation répétée ne réinitialise rien.
2. Après clôture, consulter la carte de situation en six branches, la synthèse sourcée et l’entretien intégral.
3. Relire/modifier la proposition d’email puis copier la réponse. Aucun envoi depuis cette interface.
4. Télécharger le PDF déjà préparé. Il contient portrait, vision/ressources, journée adaptée avec versions minimales, progression sur trois semaines.
5. Après une modification du corps de l’email, le PDF devient obsolète et son téléchargement est suspendu. « Adapter le PDF à ma réponse » sauvegarde la réponse et régénère le dossier en la prenant comme directive. Le corps et l’objet de la réponse humaine sont conservés à l’identique. La conversation source est conservée.

La génération du dossier utilise un effort élevé, puis PDFKit crée un vrai PDF vectoriel. Son contenu et le fichier encodé sont privés dans la colonne JSON `summary`. Le téléchargement exige l’authentification admin, est sans cache et ne publie pas de lien de stockage. La réponse élève exclut la synthèse, les brouillons, le PDF, l’email et les métadonnées de collecte.

Les entretiens anciens peuvent recevoir le dossier complet via « Générer le dossier complet ». Aucun nouveau SQL n’est nécessaire. Une ancienne conversation active reprend la nouvelle trame en conservant ses messages ; le modèle tient compte des informations déjà racontées.

## Fidélité et limites

Les éléments déclarés, interprétations de l’élève, hypothèses et inconnues sont distingués dans les observations privées avec références u1, u2… La carte représente le récit partagé, pas une expertise psychologique. Pas de diagnostic, de faux score de réussite ni de causalité familiale imposée. Les regrets d’achat restent fidèlement rapportés. Les brouillons et PDF exigent la relecture de Sonny. Le catalogue détaillé des exercices ES2 n’est pas fourni au modèle : il s’appuie sur les pratiques décrites par l’élève, sans inventer de module ou d’exercice.

## Configuration et sécurité

- SQL initial : `sql/es2_interviews.sql`, exécuté par Sonny. Table RLS, aucun droit anon/authenticated.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` : configuration existante.
- `ANTHROPIC_API_KEY_ES2_ENTRETIEN`, sinon `ANTHROPIC_API_KEY`.
- `ES2_ENTRETIEN_MODEL` : défaut `claude-fable-5-1`, pas de remplacement silencieux.
- `ES2_ENTRETIEN_TOKEN_SECRET`, sinon service_role. Ne pas changer sans migration des invitations.

Token UUID signé HMAC, seul son hash SHA256 est conservé en base. Le fragment `#t=…` évite les logs URL serveur et Referer. Le navigateur le retire puis le garde en sessionStorage. Le lien donne accès à cette seule conversation : l’unicité est par email, sans vérification d’identité civile.

Chaque écriture est conditionnée par la version (CAS), y compris les fragments de streaming et les modifications admin. Doubles envois, rejeux et workers concurrents ne dupliquent pas les messages. La signature interne protège les jobs. Bail de quatre minutes, délais fournisseur 90 secondes dialogue / 180 secondes dossier, trois tentatives par job. L’admin peut relancer explicitement un dossier échoué ou expiré. Aucun client ne peut modifier son statut ou sa synthèse.

## Vérifications

`npm run test:es2-interview` : unicité, concurrence, rejeux, bail, échecs/reprise, étapes/limites, refus, sécurité, streaming découpé, confidentialité, PDF authentifié, édition versionnée, invalidation/régénération du PDF, PostgreSQL/RLS local. Les fixtures sont fictives et ne touchent pas la production.

Production exclusivement via `npm run deploy:production`, depuis `main` propre et identique à `origin/main`. Prévisualisation via `npm run deploy:preview`.
