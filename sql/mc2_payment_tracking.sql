-- À exécuter par Sonny. Additif, réexécutable, aucun trigger sur le funnel.
-- Aucun envoi Meta / SMS / email et aucun prélèvement lors de cette migration.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.mc2_payment_tracking_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  collect_enabled boolean NOT NULL DEFAULT false,
  send_enabled boolean NOT NULL DEFAULT false,
  -- L'historique reste local : ne pas antidater artificiellement les envois Meta.
  send_from timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.mc2_payment_tracking_control(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mc2_payment_tracking_orders (
  order_id text PRIMARY KEY CHECK (order_id ~ '^[0-9]+$'),
  token text NOT NULL REFERENCES public.mc2_registrations(token),
  plan text NOT NULL CHECK (plan IN ('twelve','six')),
  purchased_at timestamptz NOT NULL,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  lease_until timestamptz,
  lease_id uuid,
  last_error text,
  contract_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mc2_payment_tracking_orders_due ON public.mc2_payment_tracking_orders(next_check_at);

-- Un paiement logique regroupe les tentatives/retries de la même échéance.
CREATE TABLE IF NOT EXISTS public.mc2_payment_tracking_ledger (
  payment_key text PRIMARY KEY,
  order_id text NOT NULL REFERENCES public.mc2_payment_tracking_orders(order_id),
  root_payment_id text NOT NULL,
  provider_payment_id text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  paid_minor integer NOT NULL CHECK (paid_minor >= 0),
  refunded_minor integer NOT NULL CHECK (refunded_minor >= 0),
  currency text NOT NULL CHECK (currency = 'EUR'),
  status text NOT NULL CHECK (status IN ('pending','failed','paid','refunded','disputed')),
  occurred_at timestamptz NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id, root_payment_id)
);

CREATE TABLE IF NOT EXISTS public.mc2_payment_tracking_outbox (
  event_key text PRIMARY KEY,
  order_id text NOT NULL REFERENCES public.mc2_payment_tracking_orders(order_id),
  event_name text NOT NULL CHECK (event_name IN ('MC2_CommitmentConfirmed','MC2_PaymentCollected','MC2_PaymentRefunded','MC2_PaymentDisputed')),
  event_id text NOT NULL UNIQUE,
  event_time timestamptz NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK(currency = 'EUR'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','retry','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_id uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mc2_payment_tracking_outbox_due ON public.mc2_payment_tracking_outbox(status,next_attempt_at);

ALTER TABLE public.mc2_payment_tracking_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc2_payment_tracking_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc2_payment_tracking_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mc2_payment_tracking_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mc2_payment_tracking_control, public.mc2_payment_tracking_orders,
  public.mc2_payment_tracking_ledger, public.mc2_payment_tracking_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mc2_payment_tracking_control, public.mc2_payment_tracking_orders,
  public.mc2_payment_tracking_ledger, public.mc2_payment_tracking_outbox TO service_role;
COMMIT;

SELECT collect_enabled, send_enabled, send_from FROM public.mc2_payment_tracking_control;
