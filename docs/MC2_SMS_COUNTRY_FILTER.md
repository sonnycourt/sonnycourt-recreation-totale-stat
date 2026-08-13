# Filtre pays des SMS MC2

Le filtre est centralisé juste avant l'appel GatewayAPI dans
`netlify/functions/lib/mc2-sms.mjs`. Il couvre donc les SMS LIVE et les SMS de
dernière chance sans modifier leur texte, leur programmation ni leurs liens.

## Activation sûre

Le filtre est **désactivé par défaut** pour ne pas modifier les flux existants.

```text
MC2_SMS_COUNTRY_FILTER_ENABLED=true
MC2_SMS_ALLOWED_COUNTRIES=FR,CH,BE,CA,LU,MC
MC2_SMS_ESTIMATED_SEGMENT_COST_EUR=0.00
```

- `MC2_SMS_ALLOWED_COUNTRIES` accepte des codes ISO alpha-2 séparés par des
  virgules et peut être modifié sans toucher au code.
- `MC2_SMS_ESTIMATED_SEGMENT_COST_EUR` est facultatif. S'il est renseigné avec
  le coût GatewayAPI réel d'un segment, le journal calcule aussi le coût évité.

## Ordre de résolution du pays

1. pays de facturation post-achat présent dans Supabase ;
2. adresse de facturation puis de livraison Stripe ;
3. pays explicitement choisi à l'inscription MC2 ;
4. indicatif téléphonique, uniquement en dernier recours.

Le préfixe `+1` reste volontairement inconnu sans autre donnée, car il couvre
plusieurs pays. Le filtre est fail-closed : pays inconnu ou non autorisé = SMS
non envoyé et l'email reste le canal de communication.

## Audit

Un SMS filtré passe à `skipped` dans `mc2_sms_jobs` avec :

- `skip_reason` : `sms_country_unknown` ou `sms_country_not_allowed` ;
- `provider_response.country_filter` : pays, source, règle appliquée, segments
  et coût estimé évités ;
- événement `sms_country_filtered` dans `mc2_funnel_events`.

Le garde-fou existe aussi dans `sendGatewaySms` : quand le filtre est activé,
un appel direct sans décision pays explicite est refusé avant tout appel réseau.

## Vérification

```bash
npm run test:mc2-sms-country-filter
```

Aucun changement de schéma Supabase n'est nécessaire pour ce filtre.
