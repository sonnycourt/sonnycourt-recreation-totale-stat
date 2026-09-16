-- MC2 : journal de mesure indépendant du lecteur, des accès et des paiements.
-- À exécuter par Sonny dans Supabase. Réexécutable, aucune donnée existante modifiée.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.mc2_tracking_events_v2 (
  event_id uuid PRIMARY KEY,
  token text NOT NULL REFERENCES public.mc2_registrations(token) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (length(event_name) BETWEEN 1 AND 64),
  client_occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  visit_id uuid NOT NULL,
  route text NOT NULL CHECK (route IN ('/mc2/session/', '/mc2/replay/')),
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2),
  webinar_version text NOT NULL,
  offer_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS mc2_tracking_v2_token_received
  ON public.mc2_tracking_events_v2 (token, received_at);
CREATE INDEX IF NOT EXISTS mc2_tracking_v2_received_name
  ON public.mc2_tracking_events_v2 (received_at, event_name);
CREATE INDEX IF NOT EXISTS mc2_tracking_v2_client_time
  ON public.mc2_tracking_events_v2 (client_occurred_at);
ALTER TABLE public.mc2_tracking_events_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mc2_tracking_events_v2 FROM anon, authenticated;
GRANT SELECT, INSERT ON public.mc2_tracking_events_v2 TO service_role;

-- Marquage explicite des tests. Ne jamais exclure un pays entier pour retirer un test.
CREATE TABLE IF NOT EXISTS public.mc2_tracking_test_registrations (
  token text PRIMARY KEY REFERENCES public.mc2_registrations(token) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mc2_tracking_test_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mc2_tracking_test_registrations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mc2_tracking_test_registrations TO service_role;

COMMENT ON TABLE public.mc2_tracking_events_v2 IS
  'Observations navigateur versionnées, sans mutation des accès, inscriptions ou paiements. Une absence de trace ne prouve pas un abandon.';
COMMIT;

-- Vérification en lecture seule : les deux noms doivent apparaître.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('mc2_tracking_events_v2', 'mc2_tracking_test_registrations');
