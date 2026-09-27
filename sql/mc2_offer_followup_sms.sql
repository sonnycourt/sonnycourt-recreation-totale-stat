-- SMS H+2 après la première offre réellement visible (tracking v2).
-- À exécuter par Sonny. Réexécutable. Aucun envoi ni rattrapage historique.
-- MC2_OFFER_FOLLOWUP_SMS_ENABLED doit rester désactivé avant validation finale.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.mc2_sms_jobs
  DROP CONSTRAINT IF EXISTS mc2_sms_jobs_message_type_check;
ALTER TABLE public.mc2_sms_jobs
  ADD CONSTRAINT mc2_sms_jobs_message_type_check
  CHECK (message_type IN ('session_live', 'offer_deadline', 'offer_followup'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_mc2_sms_offer_followup_token
  ON public.mc2_sms_jobs (token) WHERE message_type = 'offer_followup';
CREATE INDEX IF NOT EXISTS idx_mc2_tracking_offer_visible_received
  ON public.mc2_tracking_events_v2 (received_at, token) WHERE event_name = 'offer_visible';

CREATE OR REPLACE FUNCTION public.queue_mc2_offer_followup_sms(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH candidates AS (
    SELECT e.token, min(e.received_at) AS first_seen
    FROM public.mc2_tracking_events_v2 e
    WHERE e.event_name = 'offer_visible'
      AND e.received_at BETWEEN p_now - interval '2 hours 10 minutes' AND p_now - interval '2 hours'
    GROUP BY e.token
  ), inserted AS (
    INSERT INTO public.mc2_sms_jobs (token, job_key, message_type, due_at)
    SELECT c.token, 'offer_followup:' || c.token, 'offer_followup', c.first_seen + interval '2 hours'
    FROM candidates c
    JOIN public.mc2_registrations r ON r.token = c.token
    WHERE r.sms_consent_at IS NOT NULL
      AND nullif(btrim(r.telephone), '') IS NOT NULL
      AND coalesce(r.statut, '') <> 'purchased'
      AND r.purchased_at IS NULL
      AND coalesce(r.payment_status, '') NOT IN ('paid', 'succeeded', 'active', 'complete', 'completed')
      AND r.offer_expires_at > p_now
      AND NOT EXISTS (
        SELECT 1 FROM public.mc2_tracking_events_v2 prior
        WHERE prior.token = c.token AND prior.event_name = 'offer_visible' AND prior.received_at < c.first_seen
      )
      AND NOT EXISTS (SELECT 1 FROM public.mc2_tracking_test_registrations t WHERE t.token = c.token)
      AND NOT EXISTS (
        SELECT 1 FROM public.mc2_sms_jobs j WHERE j.token = c.token
          AND (j.message_type = 'offer_followup' OR j.skip_reason IN ('purchase_completed', 'spiffy_purchase_completed', 'already_purchased'))
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  ) SELECT count(*)::integer FROM inserted;
$function$;

REVOKE ALL ON FUNCTION public.queue_mc2_offer_followup_sms(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_mc2_offer_followup_sms(timestamptz) TO service_role;
COMMENT ON FUNCTION public.queue_mc2_offer_followup_sms(timestamptz) IS
  'File H+2 idempotente : première offre visible reçue côté serveur, non-acheteurs, consentement, hors tests. Appel uniquement après activation explicite.';
COMMIT;
