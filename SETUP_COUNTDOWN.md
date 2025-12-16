# Setup - Système de Countdown de 7 Jours avec Liens Dynamiques

## 📋 Ce qui a été implémenté

### ✅ Fonctions Netlify créées :
1. **`netlify/functions/init-countdown.js`** - Initialise le countdown de 7 jours (utilise Netlify Blobs)
2. **`netlify/functions/check-access.js`** - Vérifie le token et retourne le temps restant (utilise Netlify Blobs)
3. **`netlify/functions/subscribe.js`** - Modifié pour accepter le `uniqueToken`

### ✅ Pages modifiées :
1. **`/es-inscription`** - Génère le token unique et l'envoie à MailerLite
2. **`/es-video`** - Passe le token à la redirection
3. **`/esprit-subconscient`** - Vérifie le token, affiche le countdown de 7 jours, bloque l'accès sans token

---

## 🔧 Configuration requise

### 1. Installer la dépendance (si pas déjà fait)

```bash
npm install @netlify/blobs
```

### 2. Activer Netlify Blobs dans Netlify

1. Aller dans Netlify Dashboard > Votre site > **Site configuration**
2. Aller dans **Build & deploy** > **Environment**
3. Netlify Blobs est automatiquement disponible dans les fonctions Netlify
4. **Aucune configuration supplémentaire nécessaire !** 🎉

### 3. Créer le custom field dans MailerLite

1. Aller dans MailerLite > Subscribers > Custom Fields
2. Créer un nouveau champ personnalisé :
   - **Nom** : `unique_token` (ou `personal_link_token`)
   - **Type** : Text
   - **Visible** : Oui (optionnel)

### 4. Configurer les emails MailerLite

Dans vos emails de la séquence automatique, utiliser le merge tag :

```
https://sonnycourt.com/esprit-subconscient?token={{custom_field.unique_token}}
```

**Important** : Remplacez `unique_token` par le nom exact du champ que vous avez créé dans MailerLite.

---

## 🔄 Flux complet

1. **Utilisateur s'inscrit sur `/es-inscription`**
   - Token unique généré (UUID)
   - Token stocké dans localStorage + cookie
   - Token envoyé à MailerLite (custom field)
   - Countdown initialisé dans Netlify Blobs (7 jours)
   - Redirection vers `/es-video/?token=abc123`

2. **Utilisateur regarde la vidéo sur `/es-video`**
   - Token récupéré depuis l'URL
   - Après le countdown de 5:45, redirection vers `/esprit-subconscient/?token=abc123`

3. **Utilisateur arrive sur `/esprit-subconscient`**
   - Vérification du token via API
   - Si valide → affichage du countdown de 7 jours (synchronisé)
   - Si invalide/expiré → redirection vers `/es-inscription`

4. **Utilisateur clique sur le lien dans l'email MailerLite**
   - Lien contient : `?token={{custom_field.unique_token}}`
   - Arrive sur `/esprit-subconscient` avec son token
   - Countdown synchronisé (même temps restant sur tous les appareils)

---

## 🧪 Test

1. Installer la dépendance : `npm install @netlify/blobs`
2. Tester l'inscription sur `/es-inscription`
3. Vérifier que le token est créé dans Netlify Blobs (via les logs Netlify)
4. Vérifier que le token est dans MailerLite (custom field)
5. Tester l'accès à `/esprit-subconscient` avec et sans token
6. Vérifier que le countdown s'affiche correctement

---

## ⚠️ Points importants

- **Le countdown démarre au premier accès** avec le token (lors de l'inscription)
- **Le countdown est synchronisé** via Netlify Blobs (même temps sur tous les appareils)
- **L'accès est bloqué** sans token valide
- **Le token expire après 7 jours** (gestion à prévoir si besoin)
- **Netlify Blobs est automatiquement disponible** dans les fonctions Netlify (pas besoin de config)

---

## 🐛 Dépannage

### Le countdown ne s'affiche pas
- Vérifier que `@netlify/blobs` est installé : `npm install @netlify/blobs`
- Vérifier les logs Netlify Functions pour les erreurs
- Vérifier la console du navigateur pour les erreurs

### Le token n'est pas dans MailerLite
- Vérifier que le custom field existe
- Vérifier que le nom du champ correspond (`unique_token`)
- Vérifier les logs Netlify Functions

### Redirection en boucle
- Vérifier que le token est bien passé dans l'URL
- Vérifier localStorage pour les tokens existants

### Erreur "getStore is not a function"
- Vérifier que `@netlify/blobs` est installé
- Redéployer le site sur Netlify

---

## 📝 Notes

- Les tokens sont stockés dans Netlify Blobs avec expiration automatique après 7 jours
- Le countdown se synchronise toutes les minutes avec le serveur
- Le token est aussi stocké dans localStorage pour persistance locale
- **Netlify Blobs est gratuit** jusqu'à 100 GB/mois (largement suffisant)

---

## 🎯 Avantages de Netlify Blobs

✅ **Intégré directement à Netlify** - Pas besoin de service externe  
✅ **Simple** - Pas de SQL, juste get/set  
✅ **Gratuit** - Jusqu'à 100 GB/mois  
✅ **Rapide** - Accès direct par clé  
✅ **Aucune configuration** - Fonctionne automatiquement dans les fonctions Netlify
