-- Formations proposées par le closer pendant l'appel (cases cochées dans la console).
-- Tableau JSON de clés d'offres, ex. ["es2","es2_5"].
-- À exécuter une fois dans l'éditeur SQL Supabase.

alter table public.webinaire_registrations
  add column if not exists proposed_offers jsonb not null default '[]'::jsonb;
