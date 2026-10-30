-- À exécuter par Sonny dans Supabase. Réexécutable, aucun SMS envoyé.
-- L'activation MC2_SESSION_H1_SMS_ENABLED remplace ensuite le SMS fin d'offre.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mc2_sms_jobs
  DROP CONSTRAINT IF EXISTS mc2_sms_jobs_message_type_check;
ALTER TABLE public.mc2_sms_jobs
  ADD CONSTRAINT mc2_sms_jobs_message_type_check
  CHECK (message_type IN ('session_live', 'session_h1', 'offer_deadline', 'offer_followup'));

CREATE OR REPLACE FUNCTION public.queue_mc2_session_h1_sms(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH inserted AS (
    INSERT INTO public.mc2_sms_jobs (token, job_key, message_type, due_at)
    SELECT r.token,
      'session_h1:' || r.token || ':' || extract(epoch FROM r.session_starts_at)::bigint,
      'session_h1', r.session_starts_at - interval '1 hour'
    FROM public.mc2_sms_jobs live
    JOIN public.mc2_registrations r ON r.token = live.token
    WHERE live.message_type = 'session_live'
      AND live.status IN ('pending', 'retry')
      AND live.due_at = r.session_starts_at
      AND live.due_at BETWEEN p_now + interval '50 minutes' AND p_now + interval '1 hour'
      AND r.slot_kind = 'scheduled'
      AND r.registration_completed_at <= r.session_starts_at - interval '1 hour'
      AND r.sms_consent_at IS NOT NULL
      AND nullif(btrim(r.telephone), '') IS NOT NULL
      AND (r.entry_payment_required IS NOT TRUE OR r.entry_payment_paid_at IS NOT NULL)
      AND coalesce(r.statut, '') <> 'purchased'
      AND r.purchased_at IS NULL
      AND coalesce(r.payment_status, '') NOT IN ('paid', 'succeeded', 'active', 'complete', 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.mc2_tracking_test_registrations t WHERE t.token = r.token)
    ON CONFLICT (job_key) DO NOTHING
    RETURNING id
  ) SELECT count(*)::integer FROM inserted;
$function$;

REVOKE ALL ON FUNCTION public.queue_mc2_session_h1_sms(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_mc2_session_h1_sms(timestamptz) TO service_role;
COMMENT ON FUNCTION public.queue_mc2_session_h1_sms(timestamptz) IS
  'Rappel H-1 des sessions scheduled seulement. File live inchangée, aucun rattrapage au-delà de 10 minutes, déduplication par inscrit et horaire.';
COMMIT;
