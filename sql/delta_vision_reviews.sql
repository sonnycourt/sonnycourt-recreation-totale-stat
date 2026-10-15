-- Delta Vision: avis privés. À exécuter par Sonny dans le projet Supabase du site.
-- Réexécutable. Aucun email, trigger d'envoi ou changement de table existante.
begin;
create table if not exists public.delta_vision_reviews (
  id uuid primary key,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  email text not null check (char_length(email) between 3 and 254 and email = lower(btrim(email))),
  rating smallint not null check (rating between 1 and 5),
  review text not null check (char_length(btrim(review)) between 1 and 10000),
  improvements text not null default '' check (char_length(improvements) <= 10000),
  visibility text not null default 'private' check (visibility = 'private'),
  identity_verified boolean not null default false check (identity_verified = false),
  created_at timestamptz not null default now()
);
create index if not exists delta_vision_reviews_created_idx on public.delta_vision_reviews (created_at desc, id desc);
alter table public.delta_vision_reviews enable row level security;
revoke all on public.delta_vision_reviews from public, anon, authenticated;
grant select, insert on public.delta_vision_reviews to service_role;
comment on table public.delta_vision_reviews is 'Retours privés Delta Vision. Identité déclarative, aucun consentement de publication collecté.';
commit;

select
  to_regclass('public.delta_vision_reviews') is not null
  and exists (select 1 from pg_class where oid='public.delta_vision_reviews'::regclass and relrowsecurity)
  and not has_table_privilege('anon','public.delta_vision_reviews','SELECT')
  and not has_table_privilege('anon','public.delta_vision_reviews','INSERT')
  and not has_table_privilege('authenticated','public.delta_vision_reviews','SELECT')
  and not has_table_privilege('authenticated','public.delta_vision_reviews','INSERT')
  and has_table_privilege('service_role','public.delta_vision_reviews','SELECT')
  and has_table_privilege('service_role','public.delta_vision_reviews','INSERT')
  as delta_reviews_ready;
