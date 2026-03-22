# Webinaire ES 2.0 — Supabase & Netlify

## Variables d’environnement (Netlify)

| Variable | Rôle |
|----------|------|
| `SUPABASE_URL` | URL du projet |
| `SUPABASE_SERVICE_ROLE_KEY` | Accès PostgREST (bypass RLS) |
| `MAILERLITE_API_KEY` | API MailerLite |
| `MAILERLITE_GROUP_WEBINAIRE_ES2_INSCRITS` | ID groupe « Webinaire ES2 - Inscrits » |
| `MAILERLITE_GROUP_WEBINAIRE_ES2_PRESENTS` | ID groupe « Présents » |
| `MAILERLITE_GROUP_WEBINAIRE_ES2_ACHETEURS` | ID groupe « Acheteurs » |
| `MAILERLITE_GROUP_WEBINAIRE_ES2_NON_ACHETEURS` | ID groupe « Non-acheteurs » |

Fallback possible : `MAILERLITE_GROUP_WEBINAIRE_ES2` (inscrits uniquement).

## SQL Supabase

Exécuter `sql/webinaire_es2.sql` dans l’éditeur SQL.

## Champ custom MailerLite

- Nom : `unique_token_webinaire` (texte)
- Nom : `date_optin_masterclass` (texte) — rempli à l’inscription, format `jj.mm.aaaa HH:mm:ss` (Europe/Paris), ex. `22.03.2026 17:45:03`

## Cutoff inscriptions (page + API)

## Routes publiques (Astro)

- `/masterclass` — opt-in  
- `/masterclass/confirmation`  
- `/masterclass/session`  

Redirections **301** : `/webinaire`, `/webinaire/confirmation`, `/webinaire/session` → équivalents `/masterclass/...` (`netlify.toml`).

Stockage navigateur : clé **`masterclass_es2_token`** (cookie + `localStorage`). Ancienne clé `webinaire_es2_token` : migration automatique côté pages si présente.

À partir du **jeudi 19:00 (Europe/Paris)** de la semaine en cours, les nouvelles inscriptions et le countdown pointent vers le **jeudi suivant à 20:00** (impl. : `getMarketingThursdayDateParts` dans `webinaire-session-paris.mjs` + copie côté `masterclass.astro`).

## Cron

`transition-webinaire` : planifié le dimanche à **19:00 UTC** (`netlify.toml`). Vérifier l’alignement avec **20:00 Europe/Paris** selon l’heure d’été/hiver.

## Endpoints (internes)

- `POST /.netlify/functions/register-webinaire`
- `GET /.netlify/functions/get-webinaire-registration?t=`
- `POST /.netlify/functions/check-webinaire-eligibility`
- `POST /.netlify/functions/update-webinaire-status`
- `POST /.netlify/functions/add-webinaire-exclusion` (ex. webhook Spiffy)
- Scheduled : `transition-webinaire`
