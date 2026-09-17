# Exception Romain : mot de passe consultable dans Supabase

Autorisation explicite de Sonny, y compris pour l'authentification des deux CRM et leur prévisualisation. Exception limitée au compte id 22 / `2romainorfila@gmail.com`. Les autres comptes restent inchangés.

Le nouveau mot de passe est conservé **en clair** dans `closer_readable_credentials.password_plaintext`. Il n'est jamais renvoyé par la connexion, les API du CRM, le JavaScript public ou les logs. La table a RLS activée, sans droits pour `anon` / `authenticated`. Le serveur dispose uniquement de `SELECT`. Ce choix reste moins sûr qu'un hash en cas de compromission de la base ou de la clé serveur.

## Bascule ordonnée

1. Sonny exécute `sql/romain_readable_password_prepare.sql` : secret aléatoire généré en base, ligne inactive, ancien accès conservé. Réexécuter le fichier ne régénère pas le secret.
2. Tests locaux : route de connexion réelle avec réponses Supabase simulées, vérification des mauvais mots de passe, absence de fuite, compatibilité des autres comptes, migration SQL éphémère et droits.
3. Publier le nouveau code sur la preview puis en production avec le sas habituel. La ligne inactive conserve l'ancien accès. **Aucun mode d'authentification différent ou de contournement propre à la preview.**
4. Sonny exécute `sql/romain_readable_password_activate.sql` seulement après publication du nouveau `closer-login` : activation de la nouvelle valeur et retrait de l'ancien hash dans une seule transaction. Le champ historique `password_hash` reçoit le marqueur non secret `managed-readable:romain:22`, pour rester compatible avec les contrôles de présence de compte existants.
5. Vérifier la nouvelle connexion sur `/onboarding/` et `/closer-console/` (même compte et même cookie). Aucun message à Romain sans validation.

Après activation, une valeur absente, une panne de lecture ou une désactivation ne réactive jamais l'ancien mot de passe. Les cookies déjà émis suivent leur expiration existante. Le compte peut être révoqué par `closer_access_codes.active=false`.

L'ancienne action admin « changer les identifiants » refuse uniquement les changements de mot de passe/email de Romain pour ne pas recréer un hash secondaire. Ses coordonnées et les autres comptes restent gérables comme avant. Les prochains changements de son mot de passe se feront dans la colonne `password_plaintext`, par l'administrateur Supabase.

Ne pas revenir à un ancien `closer-login` après activation sans prévoir une restauration cohérente de l'authentification : l'ancien code ne comprend pas le marqueur. Ne jamais restaurer manuellement Netlify.

Test isolé : `node scripts/closer-readable-password-smoke.mjs`.
