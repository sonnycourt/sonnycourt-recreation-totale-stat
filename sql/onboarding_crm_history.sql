-- À exécuter par Sonny APRÈS onboarding_crm.sql, si Leila doit bien être incluse.
-- Reprend les repères déjà vérifiés dans la liste d'appels ; aucun envoi externe.
-- Les engagements MC2 sont déjà repris automatiquement, y compris les nouveaux.
begin;
insert into public.onboarding_cases (
  email,source,assigned_closer_id,display_name,phone,country,purchased_at,plan,
  payment_date_override,payment_date_source,special_instructions
)
select lower(btrim(r.email)),'legacy',s.closer_id,'Leila',r.telephone,'France',r.purchased_at,'legacy_three',
  date '2026-10-14','Échéance Spiffy vérifiée le 17/09/2026',
  'Leila est inscrite à l’ancien modèle en 3 versements. Elle bénéficie de 3 coachings. Ne pas évoquer un démarrage à 0 € : elle n’a pas bénéficié de cette offre.'
from public.webinaire_registrations r cross join public.onboarding_staff s
where lower(btrim(r.email))='leilast@hotmail.fr' and r.purchased_at is not null and s.default_assignee and s.active
order by r.purchased_at asc limit 1
on conflict (email) do nothing;

-- Préférences d'affichage, sans changer les identités de facturation / d'inscription.
update public.onboarding_cases set preferred_name='Vanessa Minkwet-Engone'
where email='minkwetc@gmail.com' and preferred_name is null;
update public.onboarding_cases set country_override='République dominicaine'
where email='wesleyclervil07@gmail.com' and country_override is null;
update public.onboarding_cases set country_override='Burkina Faso'
where email='eveilafriquejb@gmail.com' and country_override is null;

-- Les dates ci-dessous ont été vérifiées sur Spiffy, non déduites d'une tentative.
update public.onboarding_cases set payment_date_override=date '2026-09-23',
  payment_date_source='Échéance Spiffy vérifiée le 17/09/2026'
where email in ('sidibeousmane29@gmail.com','wesleyclervil07@gmail.com','kasendatonton@gmail.com',
  'yann.tremeau.yt@gmail.com','minkwetc@gmail.com','tludips@yahoo.fr') and payment_date_override is null;
update public.onboarding_cases set payment_date_override=date '2026-09-24',
  payment_date_source='Échéance Spiffy vérifiée le 17/09/2026'
where email in ('eveilafriquejb@gmail.com','bossejeanphilippe@gmail.com') and payment_date_override is null;
commit;
