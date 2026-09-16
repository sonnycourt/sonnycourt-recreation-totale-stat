-- Complément au journal MC2 v2 : livraison Meta durable, sans trigger sur le funnel.
-- À exécuter par Sonny. Aucun email/SMS, aucun changement de paiement ou d'inscription.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS public.mc2_tracking_meta_outbox (
  delivery_key text PRIMARY KEY,
  token text NOT NULL REFERENCES public.mc2_registrations(token) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_id text NOT NULL,
  event_time timestamptz NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','retry','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mc2_tracking_meta_due ON public.mc2_tracking_meta_outbox(status,next_attempt_at);
ALTER TABLE public.mc2_tracking_meta_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mc2_tracking_meta_outbox FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.mc2_tracking_meta_outbox TO service_role;

-- Un seul commit pour les observations et les tâches Meta associées.
-- Appel exclusivement serveur après validation stricte des événements navigateur.
CREATE OR REPLACE FUNCTION public.mc2_tracking_ingest_v2(items jsonb, request_context jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE item jsonb; mapped text; delivery text; accepted jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) > 24 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    INSERT INTO public.mc2_tracking_events_v2(event_id,token,event_name,client_occurred_at,visit_id,route,schema_version,webinar_version,offer_version,metadata)
    VALUES ((item->>'event_id')::uuid,item->>'token',item->>'event_name',(item->>'client_occurred_at')::timestamptz,
      (item->>'visit_id')::uuid,item->>'route',2,item->>'webinar_version',item->>'offer_version',COALESCE(item->'metadata','{}'::jsonb))
    ON CONFLICT (event_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.mc2_tracking_events_v2 e WHERE e.event_id=(item->>'event_id')::uuid
      AND e.token=item->>'token' AND e.event_name=item->>'event_name' AND e.visit_id=(item->>'visit_id')::uuid) THEN
      RAISE EXCEPTION 'event_id_conflict';
    END IF;
    mapped := CASE item->>'event_name'
      WHEN 'offer_visible' THEN 'OfferViewed'
      WHEN 'cta_playback_present' THEN 'MC2_CTAPresent_v2'
      WHEN 'playback_started' THEN 'MC2_PlaybackStarted_v2'
      WHEN 'checkout_opened' THEN 'InitiateCheckout'
      WHEN 'checkout_step_viewed' THEN CASE item->'metadata'->>'step' WHEN '2' THEN 'MC2_CheckoutStep2_v2' WHEN '3' THEN 'MC2_CheckoutStep3_v2' END
      ELSE NULL END;
    IF mapped IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mc2_tracking_test_registrations WHERE token=item->>'token')
      AND EXISTS (SELECT 1 FROM public.mc2_registrations WHERE token=item->>'token' AND (traffic_source='meta_ad' OR mapped='OfferViewed')) THEN
      delivery := 'journey-v2:' || (item->>'token') || ':' || mapped;
      INSERT INTO public.mc2_tracking_meta_outbox(delivery_key,token,event_name,event_id,event_time,context)
      VALUES (delivery,item->>'token',mapped,'mc2-v2-' || md5(delivery),(item->>'client_occurred_at')::timestamptz,
        request_context || jsonb_build_object('route',item->>'route'))
      ON CONFLICT (delivery_key) DO NOTHING;
    END IF;
    accepted := accepted || jsonb_build_array(item->>'event_id');
  END LOOP;
  RETURN jsonb_build_object('accepted',accepted);
END;
$$;
REVOKE ALL ON FUNCTION public.mc2_tracking_ingest_v2(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mc2_tracking_ingest_v2(jsonb,jsonb) TO service_role;
COMMIT;

SELECT to_regclass('public.mc2_tracking_meta_outbox') AS delivery_table,
       to_regprocedure('public.mc2_tracking_ingest_v2(jsonb,jsonb)') AS ingestion_function;
