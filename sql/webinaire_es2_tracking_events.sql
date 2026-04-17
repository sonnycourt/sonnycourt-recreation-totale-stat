ALTER TABLE webinaire_registrations
  ADD COLUMN IF NOT EXISTS attended_live boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS watch_max_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saw_offer boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS clicked_cta boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS visited_sales boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS watched_replay boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;
