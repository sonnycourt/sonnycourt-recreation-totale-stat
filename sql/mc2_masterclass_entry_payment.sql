-- MC2: achat ponctuel de la masterclass, distinct de l'achat du programme ES2.
-- Réexécutable. Les inscriptions existantes restent gratuites et inchangées.
begin;

alter table public.mc2_registrations
  add column if not exists entry_payment_required boolean not null default false,
  add column if not exists entry_payment_paid_at timestamptz,
  add column if not exists entry_payment_order_id text,
  add column if not exists entry_payment_checkout_id text;

create unique index if not exists mc2_entry_payment_order_unique
  on public.mc2_registrations (entry_payment_order_id)
  where entry_payment_order_id is not null;

comment on column public.mc2_registrations.entry_payment_required is
  'Paiement d’entrée masterclass requis pour cette inscription. false préserve les accès historiques.';
comment on column public.mc2_registrations.entry_payment_paid_at is
  'Date du paiement d’entrée confirmé par le serveur Spiffy. Ne représente pas un achat ES2.';

commit;
