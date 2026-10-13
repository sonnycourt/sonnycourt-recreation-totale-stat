-- A executer par Sonny dans Supabase avant le branchement des nouveaux prix.
-- Reexecutable et transactionnel. Aucune commande, aucun acces ni email modifie.
-- Les anciens tarifs restent valides pour les commandes existantes et les webhooks retardes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.dv_gift_orders drop constraint if exists dv_gift_pack_price;
alter table public.dv_gift_orders add constraint dv_gift_pack_price check (
  (pack_count = 1 and amount_cents in (2700, 4700))
  or (pack_count = 3 and amount_cents in (5100, 8100))
  or (pack_count = 5 and amount_cents = 8500)
);
commit;
