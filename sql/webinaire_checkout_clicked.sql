-- Signal "a cliqué le bouton d'inscription/commander sur la page de vente (invitation)".
-- Écrit par track-webinaire-event (event checkout_clicked). Affiché sur la console closer.
-- À exécuter une fois dans l'éditeur SQL Supabase.

alter table public.webinaire_registrations
  add column if not exists checkout_clicked boolean default false;
