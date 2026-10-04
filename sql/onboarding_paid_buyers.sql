-- À exécuter par Sonny APRÈS publication du support des plans paid_* dans le CRM.
-- Réexécutable, aucune suppression de dossier, aucune modification du paiement.
begin;
alter table public.onboarding_cases drop constraint if exists onboarding_cases_plan_check;
alter table public.onboarding_cases add constraint onboarding_cases_plan_check
  check (plan in ('twelve','six','legacy_three','paid_once','paid_monthly','paid_other'));

create or replace function public.onboarding_sync_cases() returns integer
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_coach bigint; v_count integer;
begin
  select s.closer_id into strict v_coach from public.onboarding_staff s
  join public.closer_access_codes a on a.id=s.closer_id
  where s.active and s.default_assignee and a.active and a.password_hash is not null;

  insert into public.onboarding_cases (
    email,registration_id,source,assigned_closer_id,display_name,phone,country,city,
    purchased_at,plan,payment_status,paid_installment_count
  )
  select distinct on (lower(btrim(r.email)))
    lower(btrim(r.email)),r.id,'mc2',v_coach,
    coalesce(nullif(btrim(r.billing_full_name),''),nullif(btrim(r.prenom),''),'Client'),
    coalesce(nullif(r.billing_phone,''),r.telephone),
    coalesce(nullif(r.billing_country,''),r.pays),r.billing_city,r.purchased_at,
    case
      when r.initial_payment_cents=0 and r.checkout_last_payment_mode='spiffy_j7_6x347' then 'six'
      when r.initial_payment_cents=0 and r.checkout_last_payment_mode='spiffy_j7_12x197' then 'twelve'
      when r.checkout_last_payment_mode in ('spiffy_one_time_1297','spiffy_one_time_1997') then 'paid_once'
      when r.checkout_last_payment_mode in ('spiffy_12x197','spiffy_3x767') then 'paid_monthly'
      else 'paid_other'
    end,
    r.payment_status,coalesce(r.paid_installment_count,0)
  from public.mc2_registrations r
  where r.purchased_at is not null and r.statut='purchased'
    and ((r.initial_payment_cents=0 and r.checkout_last_payment_mode in ('spiffy_j7_12x197','spiffy_j7_6x347'))
      or (r.purchased_at >= timestamptz '2026-10-02 22:00:00+00' and r.payment_status='paid'))
    and nullif(btrim(r.email),'') is not null
    and lower(r.email) <> 'demariae.cloer@vertexinbox.com'
    and lower(r.email) !~ '(test|sandbox|@example[.]com$)'
    and lower(coalesce(r.prenom,'')) not like '%test%'
    and regexp_replace(coalesce(r.telephone,''),'[^0-9]','','g') not like '%789482376'
    and not exists (select 1 from public.mc2_tracking_test_registrations t where t.token=r.token)
  order by lower(btrim(r.email)),r.purchased_at asc,r.id asc
  on conflict (email) do update set
    display_name=excluded.display_name,phone=excluded.phone,country=excluded.country,city=excluded.city,
    payment_status=excluded.payment_status,paid_installment_count=excluded.paid_installment_count
  where onboarding_cases.source='mc2' and onboarding_cases.registration_id=excluded.registration_id
    and (onboarding_cases.display_name,onboarding_cases.phone,onboarding_cases.country,onboarding_cases.city,
      onboarding_cases.payment_status,onboarding_cases.paid_installment_count)
      is distinct from (excluded.display_name,excluded.phone,excluded.country,excluded.city,
      excluded.payment_status,excluded.paid_installment_count);
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function public.onboarding_sync_cases() from public,anon,authenticated;
grant execute on function public.onboarding_sync_cases() to service_role;
-- Rattrapage immédiat ; ensuite le CRM synchronise à chaque chargement de liste.
select public.onboarding_sync_cases() as dossiers_importes_ou_actualises;
commit;
