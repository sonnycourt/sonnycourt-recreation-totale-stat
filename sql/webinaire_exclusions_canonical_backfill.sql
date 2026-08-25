-- Liste d'exclusion canonique commune au funnel historique et à MC2.
-- Sûr et réexécutable : les raisons fortes déjà présentes sont préservées.
-- À exécuter manuellement dans l'éditeur SQL Supabase.

insert into public.webinaire_exclusions (email, raison)
select distinct
  lower(trim(email)),
  case
    when statut = 'acheteur' or coalesce(purchased, false) is true then 'acheteur_es'
    else 'inscrit_webinaire'
  end
from public.webinaire_registrations
where email is not null
  and trim(email) <> ''
on conflict (email) do update
set raison = case
  when public.webinaire_exclusions.raison in (
    'acheteur_es',
    'acheteur_manifest',
    'acheteur_ssr',
    'acheteur_neuro_ia',
    'acheteur_challenge',
    'manuel'
  ) then public.webinaire_exclusions.raison
  when excluded.raison = 'acheteur_es' then excluded.raison
  else public.webinaire_exclusions.raison
end;

insert into public.webinaire_exclusions (email, raison)
select distinct
  lower(trim(email)),
  case
    when statut = 'purchased'
      or purchased_at is not null
      or payment_status in ('paid', 'succeeded', 'active', 'complete', 'completed')
      then 'acheteur_es'
    else 'inscrit_mc2'
  end
from public.mc2_registrations
where email is not null
  and trim(email) <> ''
  and (
    registration_completed_at is not null
    or statut in ('registered', 'present', 'purchased')
    or purchased_at is not null
    or payment_status in ('paid', 'succeeded', 'active', 'complete', 'completed')
  )
on conflict (email) do update
set raison = case
  when public.webinaire_exclusions.raison in (
    'acheteur_es',
    'acheteur_manifest',
    'acheteur_ssr',
    'acheteur_neuro_ia',
    'acheteur_challenge',
    'manuel'
  ) then public.webinaire_exclusions.raison
  when excluded.raison = 'acheteur_es' then excluded.raison
  else public.webinaire_exclusions.raison
end;

select raison, count(*) as total
from public.webinaire_exclusions
group by raison
order by raison;
