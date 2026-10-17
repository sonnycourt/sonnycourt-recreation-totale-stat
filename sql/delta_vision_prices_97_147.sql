-- À exécuter par Sonny. Élargit seulement les prix admis par le tracking.
-- Aucun événement historique, achat, accès, email ou cadeau n'est modifié.
-- Les anciens prix restent admis pour les onglets ouverts avant publication.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.delta_vision_analytics_events
  drop constraint if exists delta_vision_analytics_events_price_check;
alter table public.delta_vision_analytics_events
  add constraint delta_vision_analytics_events_price_check
  check (price in (27,47,97,147));
commit;
select exists (
  select 1 from pg_constraint
  where conrelid='public.delta_vision_analytics_events'::regclass
    and conname='delta_vision_analytics_events_price_check'
    and pg_get_constraintdef(oid) like '%97%'
    and pg_get_constraintdef(oid) like '%147%'
) as delta_prices_ready;
