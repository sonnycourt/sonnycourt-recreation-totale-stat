-- Backfill sûr et réexécutable des personnes ayant réellement assisté.
-- Les exclusions existantes (acheteurs et exclusions manuelles) sont préservées.

insert into public.webinaire_exclusions (email, raison)
select distinct lower(trim(email)), 'participant_webinaire'
from public.webinaire_registrations
where email is not null
  and trim(email) <> ''
  and statut in ('present', 'non-acheteur', 'acheteur')
on conflict (email) do nothing;

insert into public.webinaire_exclusions (email, raison)
select distinct lower(trim(email)), 'participant_mc2'
from public.mc2_registrations
where email is not null
  and trim(email) <> ''
  and attended_live is true
on conflict (email) do nothing;

select raison, count(*) as total
from public.webinaire_exclusions
group by raison
order by raison;
