-- Colonne acheteur ES 2.0 (dashboard Vue d'ensemble, segmentation).
-- À exécuter dans le SQL Editor Supabase si la colonne n'existe pas encore.

ALTER TABLE webinaire_registrations
  ADD COLUMN IF NOT EXISTS purchased boolean DEFAULT false;
