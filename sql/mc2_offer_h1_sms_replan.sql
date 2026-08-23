-- Replanification opérationnelle des anciens jobs SMS d'offre MC2.
-- Aucun changement de schéma. Réexécutable sans dupliquer de job.
-- À exécuter manuellement par Sonny seulement après publication du code H-1
-- et avant d'activer MC2_OFFER_H1_SMS_ENABLED=true.

begin;

-- La nouvelle politique autorise une seule tentative Gateway. Un ancien retry
-- a déjà consommé au moins une tentative et ne doit donc pas repartir.
update public.mc2_sms_jobs
set status = 'skipped',
    skip_reason = 'legacy_retry_not_requeued',
    last_error = coalesce(last_error, 'replaced_by_h1_single_attempt_policy')
where message_type = 'offer_deadline'
  and status = 'retry';

-- Les jobs encore vierges sont déplacés à exactement H-1. Les offres déjà
-- entrées dans leur dernière heure ne sont pas ressuscitées tardivement.
update public.mc2_sms_jobs as job
set due_at = registration.offer_expires_at - interval '1 hour',
    status = 'pending',
    last_error = null,
    skip_reason = null
from public.mc2_registrations as registration
where job.token = registration.token
  and job.message_type = 'offer_deadline'
  and job.status = 'pending'
  and job.attempts = 0
  and registration.offer_expires_at is not null
  and registration.offer_expires_at > now() + interval '1 hour'
  and job.due_at is distinct from registration.offer_expires_at - interval '1 hour';

commit;

-- Contrôle post-exécution : ce SELECT n'envoie rien.
select job.id,
       job.token,
       job.status,
       job.attempts,
       job.due_at,
       registration.offer_expires_at
from public.mc2_sms_jobs as job
join public.mc2_registrations as registration using (token)
where job.message_type = 'offer_deadline'
  and job.status in ('pending', 'retry')
order by job.due_at asc;

