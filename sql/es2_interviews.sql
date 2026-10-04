-- ES2 : un entretien unique par adresse élève, accessible uniquement côté serveur.
-- À exécuter par Sonny dans l’éditeur SQL Supabase. Réexécutable, sans effacement.
BEGIN;
CREATE TABLE IF NOT EXISTS public.es2_interviews (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  first_name text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','completed','revoked')),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages) = 'array'),
  summary jsonb,
  job jsonb,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS es2_interviews_updated_idx ON public.es2_interviews (updated_at DESC);
ALTER TABLE public.es2_interviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.es2_interviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.es2_interviews TO service_role;
COMMENT ON TABLE public.es2_interviews IS 'Entretiens ES2 privés. Un seul entretien par email normalisé. Tokens hachés. Accès par fonctions serveur uniquement.';
NOTIFY pgrst, 'reload schema';
COMMIT;
