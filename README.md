# Sonny Court - Site Web Astro

Un site web moderne et professionnel pour Sonny Court, spécialisé dans la reprogrammation du subconscient et le développement personnel.

## 🚀 Configuration Production

### Variables d'environnement Netlify

Pour que la newsletter MailerLite fonctionne, ajoutez ces variables dans Netlify :

```
MAILERLITE_API_KEY=votre_api_key_mailerlite
MAILERLITE_GROUP_ID=votre_group_id_mailerlite
```

### Comment trouver ces informations :

1. **API Key** : MailerLite Dashboard → Settings → Developer API → API Key
2. **Group ID** : MailerLite Dashboard → Subscribers → votre groupe → ID dans l'URL

## 🚀 Technologies

- **Astro** - Framework web moderne pour des sites statiques performants
- **TypeScript** - Typage statique pour un code plus robuste
- **CSS** - Styles personnalisés avec animations avancées
- **JavaScript** - Interactivité côté client

## 📁 Structure du projet

```
sonnycourt-astro/
├── src/
│   ├── components/          # Composants réutilisables
│   │   ├── Header.astro    # Navigation principale
│   │   └── Footer.astro    # Pied de page
│   ├── layouts/            # Layouts de base
│   │   └── Layout.astro    # Layout principal avec SEO
│   ├── pages/              # Pages du site
│   │   ├── index.astro     # Page d'accueil
│   │   └── contact.astro   # Page de contact
│   ├── content/            # Contenu (articles, formations)
│   │   ├── blog/           # Articles de blog
│   │   └── formations/     # Pages de formations
│   └── styles/             # Styles globaux
├── public/                 # Assets statiques
├── astro.config.mjs        # Configuration Astro
├── package.json            # Dépendances
└── tsconfig.json           # Configuration TypeScript
```

## 🎨 Fonctionnalités

### ✅ Implémentées
- **Page d'accueil** avec animations et effets visuels avancés
- **Navigation responsive** avec menu mobile
- **Footer** complet avec liens et réseaux sociaux
- **Page de contact** avec formulaire
- **SEO optimisé** avec meta tags et Open Graph
- **Design responsive** pour tous les appareils
- **Animations fluides** et effets de parallax
- **Système de composants** réutilisables

### 🔄 À venir
- **Système de blog** avec articles
- **Pages de formations** détaillées
- **Système de newsletter** fonctionnel
- **Intégration CMS** pour le contenu
- **Analytics** et tracking
- **Optimisation performance** avancée

## 🛠️ Installation

1. **Cloner le projet**
```bash
git clone [url-du-repo]
cd sonnycourt-astro
```

2. **Installer les dépendances**
```bash
npm install
```

3. **Lancer le serveur de développement**
```bash
npm run dev
```

4. **Ouvrir dans le navigateur**
```
http://localhost:4321
```

## 📦 Scripts disponibles

```bash
npm run dev      # Serveur de développement
npm run build    # Build de production
npm run preview  # Prévisualiser le build
npm run astro    # Commandes Astro
```

## 🎯 Pages disponibles

- **/** - Page d'accueil avec hero section et newsletter
- **/contact/** - Page de contact avec formulaire
- **/formations/** - (À venir) Pages de formations
- **/blog/** - (À venir) Articles de blog

## 🎨 Design System

### Couleurs
- **Primaire** : `#007AFF` (Bleu iOS)
- **Fond** : `#0a0f1c` → `#1a1f2e` (Dégradé sombre)
- **Texte** : `#FFFFFF` (Blanc)
- **Texte secondaire** : `#8E8E93` (Gris)
- **Bordures** : `rgba(255, 255, 255, 0.1)` (Blanc transparent)

### Typographie
- **Famille** : `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif`
- **Titres** : Font-weight 700, letter-spacing -0.04em
- **Corps** : Font-weight 400, line-height 1.6

### Composants
- **Cartes** : Border-radius 16-24px, backdrop-filter blur
- **Boutons** : Border-radius 12-50px, gradients
- **Formulaires** : Border-radius 12px, focus states

## 📱 Responsive Design

Le site est optimisé pour :
- **Desktop** : 1200px+
- **Tablette** : 768px - 1024px
- **Mobile** : 375px - 768px
- **Très petit** : < 375px

## 🚀 Déploiement

### Netlify
1. Connecter le repository GitHub
2. Build command : `npm run build`
3. Publish directory : `dist`

### Vercel
1. Connecter le repository GitHub
2. Framework preset : Astro
3. Build automatique

## 🔧 Configuration

### Variables d'environnement
Créer un fichier `.env` :
```env
PUBLIC_SITE_URL=https://sonnycourt.com
PUBLIC_CONTACT_EMAIL=contact@sonnycourt.com
```

### SEO
Les meta tags sont configurés dans `src/layouts/Layout.astro` :
- Open Graph
- Twitter Cards
- Canonical URLs
- Meta descriptions

## 📈 Performance

Le site est optimisé pour :
- **Core Web Vitals** : LCP, FID, CLS
- **SEO** : Meta tags, sitemap, robots.txt
- **Accessibilité** : ARIA labels, contrast ratios
- **Mobile-first** : Design responsive

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature
3. Commiter les changements
4. Pousser vers la branche
5. Ouvrir une Pull Request

## 📄 Licence

Ce projet est privé et propriétaire de Sonny Court.

## 📞 Support

Pour toute question ou problème :
- **Email** : contact@sonnycourt.com
- **GitHub** : Ouvrir une issue

---

**Développé avec ❤️ pour Sonny Court**
