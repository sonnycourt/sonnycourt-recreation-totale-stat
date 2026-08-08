-- Projection métier additive de Pay.
-- Ce fichier ne modifie et ne supprime aucune donnée existante.

create table if not exists public.pay_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  mode text not null default 'dry_run' check (mode in ('dry_run', 'write')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_from timestamptz,
  source_to timestamptz,
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_inserted integer not null default 0 check (rows_inserted >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  error_code text,
  checksum text,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.pay_sync_cursors (
  provider text not null,
  resource text not null,
  cursor text,
  watermark_at timestamptz,
  last_synced_at timestamptz,
  last_run_id uuid references public.pay_sync_runs(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  primary key (provider, resource)
);

create table if not exists public.pay_customers (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  email text,
  email_normalized text,
  first_name text,
  last_name text,
  display_name text,
  phone text,
  country text,
  currency text,
  lifetime_value_minor bigint not null default 0,
  order_count integer not null default 0 check (order_count >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create index if not exists pay_customers_email_idx
  on public.pay_customers(email_normalized);

create table if not exists public.pay_products (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  name text not null,
  description text,
  active boolean not null default true,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create table if not exists public.pay_prices (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  product_id uuid references public.pay_products(id) on delete restrict,
  label text,
  currency text not null,
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  billing_type text not null check (billing_type in ('one_time', 'recurring', 'installment')),
  interval_unit text,
  interval_count integer,
  installment_count integer,
  active boolean not null default true,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create table if not exists public.pay_checkouts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  product_id uuid references public.pay_products(id) on delete restrict,
  price_id uuid references public.pay_prices(id) on delete restrict,
  name text not null,
  slug text,
  public_url text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  sales_minor_30d bigint not null default 0,
  customer_count_30d integer not null default 0 check (customer_count_30d >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create table if not exists public.pay_orders (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  customer_id uuid references public.pay_customers(id) on delete restrict,
  checkout_id uuid references public.pay_checkouts(id) on delete restrict,
  status text not null,
  currency text not null,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  finance_fee_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  refunded_minor bigint not null default 0,
  promo_code text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create index if not exists pay_orders_created_idx
  on public.pay_orders(source_created_at desc);
create index if not exists pay_orders_customer_idx
  on public.pay_orders(customer_id, source_created_at desc);

create table if not exists public.pay_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pay_orders(id) on delete restrict,
  external_id text,
  product_id uuid references public.pay_products(id) on delete restrict,
  price_id uuid references public.pay_prices(id) on delete restrict,
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_amount_minor bigint not null default 0,
  total_minor bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unique (order_id, external_id)
);

create table if not exists public.pay_payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  order_id uuid references public.pay_orders(id) on delete restrict,
  customer_id uuid references public.pay_customers(id) on delete restrict,
  payment_plan_id uuid,
  status text not null,
  currency text not null,
  amount_minor bigint not null default 0,
  refunded_minor bigint not null default 0,
  fee_minor bigint,
  net_minor bigint,
  payment_method_type text,
  payment_method_brand text,
  payment_method_last4 text,
  description text,
  paid_at timestamptz,
  due_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create index if not exists pay_payments_paid_idx
  on public.pay_payments(paid_at desc);
create index if not exists pay_payments_customer_idx
  on public.pay_payments(customer_id, paid_at desc);

create table if not exists public.pay_refunds (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  payment_id uuid references public.pay_payments(id) on delete restrict,
  order_id uuid references public.pay_orders(id) on delete restrict,
  status text not null,
  currency text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  reason text,
  refunded_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create table if not exists public.pay_payment_plans (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  order_id uuid references public.pay_orders(id) on delete restrict,
  customer_id uuid references public.pay_customers(id) on delete restrict,
  product_id uuid references public.pay_products(id) on delete restrict,
  status text not null,
  currency text not null,
  installment_amount_minor bigint not null default 0,
  installment_count integer,
  installments_paid integer not null default 0 check (installments_paid >= 0),
  remaining_minor bigint not null default 0,
  started_at timestamptz,
  next_payment_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pay_payments_payment_plan_fk'
  ) then
    alter table public.pay_payments
      add constraint pay_payments_payment_plan_fk
      foreign key (payment_plan_id) references public.pay_payment_plans(id) on delete restrict;
  end if;
end;
$$;

create index if not exists pay_payment_plans_next_idx
  on public.pay_payment_plans(status, next_payment_at);

create table if not exists public.pay_installments (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  payment_plan_id uuid not null references public.pay_payment_plans(id) on delete restrict,
  payment_id uuid references public.pay_payments(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  status text not null,
  currency text not null,
  amount_minor bigint not null default 0,
  due_at timestamptz,
  paid_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id),
  unique (payment_plan_id, sequence_number)
);

create table if not exists public.pay_discounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'paypal', 'spiffy', 'internal')),
  external_id text not null,
  code text not null,
  status text not null default 'active' check (status in ('active', 'expired', 'archived')),
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  amount_minor bigint,
  percent_off numeric(7, 4),
  currency text,
  applies_to_one_time boolean not null default true,
  applies_to_recurring boolean not null default false,
  once_per_customer boolean not null default false,
  max_redemptions integer,
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  expires_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (provider, external_id)
);

create index if not exists pay_discounts_code_idx
  on public.pay_discounts(code);

create table if not exists public.pay_report_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  report_type text not null check (report_type in ('product_sales', 'customer_ltv', 'checkout_performance', 'payment_plan_performance', 'cashflow', 'failed_payments')),
  filters jsonb not null default '{}'::jsonb,
  schedule text,
  active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pay_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('order', 'customer', 'payment_plan', 'payment')),
  entity_id uuid not null,
  body text not null,
  created_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists pay_notes_entity_idx
  on public.pay_notes(entity_type, entity_id, created_at desc);

alter table public.pay_sync_runs enable row level security;
alter table public.pay_sync_cursors enable row level security;
alter table public.pay_customers enable row level security;
alter table public.pay_products enable row level security;
alter table public.pay_prices enable row level security;
alter table public.pay_checkouts enable row level security;
alter table public.pay_orders enable row level security;
alter table public.pay_order_items enable row level security;
alter table public.pay_payments enable row level security;
alter table public.pay_refunds enable row level security;
alter table public.pay_payment_plans enable row level security;
alter table public.pay_installments enable row level security;
alter table public.pay_discounts enable row level security;
alter table public.pay_report_definitions enable row level security;
alter table public.pay_notes enable row level security;

revoke all on table public.pay_sync_runs, public.pay_sync_cursors,
  public.pay_customers, public.pay_products, public.pay_prices,
  public.pay_checkouts, public.pay_orders, public.pay_order_items,
  public.pay_payments, public.pay_refunds, public.pay_payment_plans,
  public.pay_installments, public.pay_discounts,
  public.pay_report_definitions, public.pay_notes
from public, anon, authenticated, service_role;

grant select, insert, update on table public.pay_sync_runs,
  public.pay_sync_cursors, public.pay_customers, public.pay_products,
  public.pay_prices, public.pay_checkouts, public.pay_orders,
  public.pay_order_items, public.pay_payments, public.pay_refunds,
  public.pay_payment_plans, public.pay_installments,
  public.pay_discounts, public.pay_report_definitions, public.pay_notes
to service_role;
