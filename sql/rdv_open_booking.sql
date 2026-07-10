-- Page /rdv v2 : calendrier d'abord, identification (prénom/email/tél) au moment
-- de réserver. À exécuter une fois dans l'éditeur SQL Supabase, AVANT le déploiement.

-- Numéro saisi par le lead au moment de la réservation (peut différer de celui
-- de l'inscription : c'est LE numéro à appeler pour le RDV).
alter table public.webinaire_registrations
  add column if not exists rdv_phone text;

-- Recherche d'un inscrit par téléphone quand l'email ne matche pas.
-- Comparaison sur les 9 derniers chiffres (ignore +33/+41/0, espaces, tirets).
-- En cas de doublon (~1% des numéros), on prend l'inscription la plus récente.
create or replace function public.find_webinaire_registration_by_phone(p_digits text)
returns setof public.webinaire_registrations
language sql
stable
as $$
  select *
  from public.webinaire_registrations
  where length(regexp_replace(coalesce(p_digits,''), '\D', '', 'g')) >= 8
    and right(regexp_replace(coalesce(telephone,''), '\D', '', 'g'), 9)
      = right(regexp_replace(p_digits, '\D', '', 'g'), 9)
  order by created_at desc
  limit 1;
$$;
