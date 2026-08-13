# Onboarding Circle après achat MC2

## Comportement

Après un `checkout.session.completed` MC2 dont `payment_status` vaut `paid` :

1. le webhook Stripe enregistre un job unique dans Supabase ;
2. le worker cherche le membre Circle par email ;
3. s'il n'existe pas, Circle l'invite ;
4. le worker ajoute uniquement le tag exact `ES 2.0 (AVANCÉ)` ;
5. le job finit en `succeeded` ou est relancé jusqu'à cinq fois.

Le code n'implémente aucune suppression de membre, aucun retrait de tag et
aucune mise à jour de profil d'un membre existant.

## Activation contrôlée

1. Exécuter manuellement `sql/mc2_circle_onboarding.sql` dans Supabase.
2. Créer dans Circle un token dédié de type **Admin API v2**.
3. Configurer côté serveur Netlify, sans exposer les valeurs au navigateur :

   - `CIRCLE_ADMIN_API_TOKEN`
   - `CIRCLE_COMMUNITY_HOST=volt.sonnycourt.com`
   - `MC2_CIRCLE_MEMBER_TAG_NAME=ES 2.0 (AVANCÉ)`
   - `MC2_CIRCLE_ENABLED=false`

4. Faire une vérification en lecture seule du token et du tag exact.
5. Faire un achat sandbox contrôlé, puis passer `MC2_CIRCLE_ENABLED=true`.

Tant que `MC2_CIRCLE_ENABLED` n'est pas exactement `true`, aucun job n'est créé
et aucun appel Circle n'est déclenché. Ce verrou évite qu'un déploiement de code
précède par erreur la migration SQL ou la configuration du secret.

## Relance manuelle sûre

Après correction d'une configuration, un job épuisé peut être remis en file
depuis l'éditeur SQL Supabase, sans recréer d'achat ni de membre :

```sql
update public.mc2_circle_onboarding_jobs
set status = 'retry',
    attempts = 0,
    next_attempt_at = now(),
    last_error = null,
    failed_at = null
where id = :job_id
  and status = 'failed';
```

Le worker relit toujours Circle avant toute écriture : un membre déjà invité
n'est pas réinvité et un tag déjà présent n'est pas ajouté une seconde fois.
