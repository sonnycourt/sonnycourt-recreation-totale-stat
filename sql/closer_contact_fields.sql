-- Coordonnées affichées au closer dans sa console : 2 téléphones + 2 liens checkout.
-- À exécuter une fois dans l'éditeur SQL Supabase.
-- checkout_full_url     = lien tarif complet (prospect)
-- checkout_discount_url = lien checkout du closer avec -5 %

alter table public.closer_access_codes add column if not exists phone_1 text;
alter table public.closer_access_codes add column if not exists phone_2 text;
alter table public.closer_access_codes add column if not exists checkout_full_url text;
alter table public.closer_access_codes add column if not exists checkout_discount_url text;
