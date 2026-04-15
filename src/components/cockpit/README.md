# Cockpit Funnel (Umami)

## 1) Générer une clé API Umami (optionnel)

Si tu préfères une auth API key (Cloud ou self-hosted avec clé) :

1. Ouvre Umami (`https://stats.sonnycourt.com`)
2. Va dans **Profile → API Keys**
3. Crée une clé
4. Copie-la dans Netlify en variable `UMAMI_API_KEY`

> Dans l'implémentation actuelle, le mode principal utilise `UMAMI_USERNAME` + `UMAMI_PASSWORD` (self-hosted), donc la clé n'est pas obligatoire.

## 2) Configurer les variables sur Netlify

Dans **Netlify → Site settings → Environment variables** :

- `UMAMI_BASE_URL=https://stats.sonnycourt.com`
- `UMAMI_WEBSITE_ID=3f4e4f08-4822-432d-8016-c4052ac85fe7`
- `UMAMI_USERNAME=...`
- `UMAMI_PASSWORD=...`
- (optionnel) `UMAMI_API_KEY=...`

## 3) Tester en local avec Netlify Dev

```bash
netlify dev
```

Puis :

1. Ouvre `http://localhost:8888/es-cockpit/`
2. Connecte-toi
3. Va sur `http://localhost:8888/es-cockpit/dashboard`
4. Clique l'onglet **Funnel**
5. Vérifie que les cartes et le funnel se chargent

L'endpoint consommé par le composant est :

- `GET /api/umami-funnel-stats?startAt=...&endAt=...`

L'API key Umami n'est jamais exposée côté client.

